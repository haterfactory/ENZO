/**
 * project-idor.test.ts — access control on generated projects.
 * Run with: npx tsx tests/project-idor.test.ts
 *
 * The original version of this file used mocha's describe/it globals and the
 * supertest package — neither is installed — and asserted DELETEs against
 * routes never registered on its app, so it could not run at all. This rewrite
 * uses the same tsx + node:assert + raw http style as the rest of the suite
 * and mounts the REAL projectRouter, so the ownership middleware that guards
 * production traffic is what's actually under test.
 *
 * Ownership semantics (the 2026-09-25 fix): the old raw compare against the
 * save-time token 403'd the owner once the 12h token window rolled over and
 * locked out legacy projects with no owner token at all. Ownership is now
 * "holds a currently-valid vault token" — on a single-operator instance that
 * is the operator's own browser; the project id itself stays the unlisted
 * capability (the headerless preview/document routes are credential-free for
 * the same reason). This file mints a REAL token (vaultSessionToken) instead
 * of asserting with fake strings, and asserts the gate fails closed on
 * right-shaped-but-wrong and missing tokens.
 *
 * The 2026-10 audit pass tightened it further: every user of a shared
 * instance mints the SAME per-window token, so the token alone cannot tell
 * users apart. Projects now also record the creator's `x-enzo-owner` device
 * id, and BOTH the save-over route and the ownership middleware enforce it
 * when a manifest carries one (legacy projects stay token-only, with a
 * first-updater claim). /api/project/save is also rate-limited and the served
 * entry pages keep the `Content-Security-Policy: sandbox` header. The tests
 * below cover that whole matrix.
 *
 * Hermetic: PROJECTS_DIR is resolved from process.cwd() at import time, so we
 * chdir into a temp dir BEFORE importing project.ts — nothing touches the
 * repo's real generated-projects/ folder.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import express from 'express';

// PROJECTS_DIR is resolved from process.cwd() at project.ts import time, so we
// must chdir into a temp dir BEFORE the dynamic import inside main() below —
// nothing touches the repo's real generated-projects/ folder.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'enzo-idor-'));
process.chdir(TMP);

function req(
  port: number,
  method: 'GET' | 'DELETE' | 'POST',
  urlPath: string,
  token?: string,
  body?: object,
  owner?: string,
): Promise<{ status: number; json: any; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const r = http.request(
      {
        host: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers: {
          ...(token ? { 'x-vault-token': token } : {}),
          ...(owner ? { 'x-enzo-owner': owner } : {}),
          ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let json: any = null;
          try {
            json = JSON.parse(raw);
          } catch {
            /* non-JSON body is fine */
          }
          resolve({ status: res.statusCode || 0, json, body: raw, headers: res.headers });
        });
      },
    );
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

async function main() {
  // Real token material for the owner assertions. Test values only — no
  // key-literal shapes (the CI secret scanner greps every tracked file).
  process.env.ENZO_MASTER_KEY = 'test-master-key-idor-suite';
  process.env.GROQ_API_KEY = 'test-groq-key-idor-suite';

  // Import AFTER the chdir above so PROJECTS_DIR lands in the temp dir.
  const { saveProject, projectExists, checkProjectOwnership, checkProjectReadAccess, projectRouter } = await import(
    '../src/projects/project.js'
  );
  const { vaultSessionToken } = await import('../src/core/vault-token.js');
  const app = express();
  app.use(express.json({ limit: '12mb' }));
  app.use(projectRouter);
  const srv = http.createServer(app);
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as import('net').AddressInfo).port;

  try {
    const owner = vaultSessionToken();
    assert.ok(owner && /^[a-f0-9]{64}$/.test(owner), 'a real vault token mints under the test master key');
    // Right shape (64 hex chars), wrong HMAC — the gate must not be fooled by shape.
    const fake = 'a'.repeat(64);

    // ── 1. Manifest gate: the valid token is the grant, fail-closed otherwise ──
    const p1 = await saveProject({ 'index.html': '<h1>Project 1</h1>' }, 'P1', undefined, owner);
    const p2 = await saveProject({ 'index.html': '<h1>Project 2</h1>' }, 'P2', undefined, owner);
    assert.ok(p1.id && p2.id, 'both projects saved');

    const fakeReads = await req(port, 'GET', `/api/project/${p1.id}/manifest`, fake);
    assert.strictEqual(fakeReads.status, 403, 'a right-shaped but wrong token cannot open a project');
    const noTokenReads = await req(port, 'GET', `/api/project/${p1.id}/manifest`);
    assert.strictEqual(noTokenReads.status, 403, 'anonymous cannot open a project');
    const ownerReads = await req(port, 'GET', `/api/project/${p1.id}/manifest`, owner);
    assert.strictEqual(ownerReads.status, 200, 'owner can open own project');
    assert.ok(Array.isArray(ownerReads.json.files), 'owner gets the file list');
    console.log('✔ manifest gate: valid token 200, fake/missing token 403 (fail closed)');

    // ── 2. Unauthorized delete: a wrong token cannot destroy anyone's work ──
    const p3 = await saveProject({ 'index.html': '<h1>Deletion Test</h1>' }, 'P3', undefined, owner);
    const fakeDeletes = await req(port, 'DELETE', `/api/project/${p3.id}`, fake);
    assert.strictEqual(fakeDeletes.status, 403, 'delete with a wrong token is forbidden');
    assert.ok(projectExists(p3.id), 'project survives unauthorized delete attempt');

    const noTokenDeletes = await req(port, 'DELETE', `/api/project/${p3.id}`);
    assert.strictEqual(noTokenDeletes.status, 403, 'anonymous delete is forbidden');
    assert.ok(projectExists(p3.id), 'project survives anonymous delete attempt');

    const ownerDeletes = await req(port, 'DELETE', `/api/project/${p3.id}`, owner);
    assert.strictEqual(ownerDeletes.status, 200, 'owner delete succeeds');
    assert.ok(!projectExists(p3.id), 'project removed after owner delete');
    const gone = await req(port, 'DELETE', `/api/project/${p3.id}`, owner);
    assert.strictEqual(gone.status, 404, 'deleting a removed project 404s');
    console.log('✔ unauthorized deletes blocked, owner delete works, gone project 404s');

    // ── 3. Ownership predicate: valid token, wrong token, missing token ──
    assert.strictEqual(checkProjectOwnership(p1.id, owner), true, 'a valid vault token owns');
    assert.strictEqual(checkProjectOwnership(p1.id, fake), false, 'a right-shaped wrong token rejected');
    assert.strictEqual(checkProjectOwnership(p1.id, undefined), false, 'missing token rejected');
    console.log('✔ checkProjectOwnership: validity-based, fails closed on fake/missing tokens');

    // ── 4. Save-over gate: an existing project id is a write into someone's
    //      workspace — needs a valid token AND the recorded device owner ──
    const ownerDevice = 'device-alpha-01';
    const otherDevice = 'device-beta-02';
    const p4 = await saveProject({ 'index.html': '<h1>Owned v1</h1>' }, 'P4', undefined, owner, ownerDevice);
    assert.ok(p4.id, 'owned project saved');

    const anonOverwrite = await req(port, 'POST', '/api/project/save', undefined, { files: { 'index.html': '<h1>pwned</h1>' }, id: p4.id });
    assert.strictEqual(anonOverwrite.status, 403, 'anonymous cannot save over an existing project');
    const fakeOverwrite = await req(port, 'POST', '/api/project/save', fake, { files: { 'index.html': '<h1>pwned</h1>' }, id: p4.id });
    assert.strictEqual(fakeOverwrite.status, 403, 'a right-shaped wrong token cannot save over an existing project');
    const crossDeviceOverwrite = await req(port, 'POST', '/api/project/save', owner, { files: { 'index.html': '<h1>pwned</h1>' }, id: p4.id }, otherDevice);
    assert.strictEqual(crossDeviceOverwrite.status, 403, 'a different device id cannot save over a recorded-owner project');

    const unchanged = await req(port, 'GET', `/api/project/${p4.id}/`);
    assert.ok(unchanged.body.includes('Owned v1'), 'every denied overwrite left the files untouched');
    const manifestAfter = await req(port, 'GET', `/api/project/${p4.id}/manifest`, owner, undefined, ownerDevice);
    assert.strictEqual(manifestAfter.status, 200, 'manifest opens for the recorded device');
    const manifestCross = await req(port, 'GET', `/api/project/${p4.id}/manifest`, owner, undefined, otherDevice);
    assert.strictEqual(manifestCross.status, 403, 'manifest is device-gated too');
    const deleteCross = await req(port, 'DELETE', `/api/project/${p4.id}`, owner, undefined, otherDevice);
    assert.strictEqual(deleteCross.status, 403, 'delete is device-gated too');
    assert.ok(projectExists(p4.id), 'project survives cross-device delete attempt');

    const ownerOverwrite = await req(port, 'POST', '/api/project/save', owner, { files: { 'index.html': '<h1>Owned v2</h1>' }, id: p4.id }, ownerDevice);
    assert.strictEqual(ownerOverwrite.status, 200, 'the recorded device saves over its own project');
    assert.ok(ownerOverwrite.json?.id === p4.id, 'the upsert lands in the SAME container');
    const updated = await req(port, 'GET', `/api/project/${p4.id}/`);
    assert.ok(updated.body.includes('Owned v2'), 'owner overwrite landed on disk');
    const manifestStillOwner = await req(port, 'GET', `/api/project/${p4.id}/manifest`, owner, undefined, ownerDevice);
    assert.strictEqual(manifestStillOwner.status, 200, 'owner id survives the update (never clobbered)');
    console.log('✔ save-over gate: anonymous/wrong-token/cross-device 403, owner update lands in the same container');

    // Read-side twin: a chat request naming a foreign projectId must not pull
    // the owner's code into the attacker's model context.
    assert.strictEqual(checkProjectReadAccess(p4.id, ownerDevice), true, 'recorded device may read its project context');
    assert.strictEqual(checkProjectReadAccess(p4.id, otherDevice), false, 'a foreign device may NOT read a recorded-owner project');
    assert.strictEqual(checkProjectReadAccess(p4.id, undefined), false, 'missing device id may NOT read a recorded-owner project');
    console.log('✔ project read access: device-gated for recorded owners');

    // ── 5. Legacy projects (no recorded device): token-only grant, first
    //      authorized updater claims the device id ──
    const p5 = await saveProject({ 'index.html': '<h1>Legacy</h1>' }, 'P5', undefined, owner);
    assert.ok(p5.id, 'legacy project saved without a device owner');
    const legacyThirdDevice = 'device-gamma-003';
    const legacyClaim = await req(port, 'POST', '/api/project/save', owner, { files: { 'index.html': '<h1>Legacy v2</h1>' }, id: p5.id }, legacyThirdDevice);
    assert.strictEqual(legacyClaim.status, 200, 'a valid token updates a legacy project (no recorded owner)');
    const legacyFourthDevice = 'device-delta-04';
    const afterClaim = await req(port, 'POST', '/api/project/save', owner, { files: { 'index.html': '<h1>pwned</h1>' }, id: p5.id }, legacyFourthDevice);
    assert.strictEqual(afterClaim.status, 403, 'after the claim, other devices are locked out');
    assert.strictEqual(checkProjectReadAccess(p5.id, legacyThirdDevice), true, 'the claiming device may read the legacy project');
    assert.strictEqual(checkProjectReadAccess(p5.id, legacyFourthDevice), false, 'other devices may not read it after the claim');
    console.log('✔ legacy claim: token-only update works, claim sticks, later devices 403');

    // ── 6. Preview isolation header: served entry pages keep CSP sandbox ──
    const indexPage = await req(port, 'GET', `/api/project/${p4.id}/`);
    assert.ok(
      (indexPage.headers['content-security-policy'] || '').includes('sandbox'),
      'the project entry page carries the sandbox CSP for the open-in-new-tab path',
    );
    console.log('✔ CSP sandbox header present on served project pages');

    // ── 7. Rate limit: save floods get 429s (runs last — shared per-IP bucket) ──
    const floodStatuses: number[] = [];
    for (let i = 0; i < 62; i++) {
      const r = await req(port, 'POST', '/api/project/save', owner, { files: { 'index.html': `<h1>flood ${i}</h1>` } });
      floodStatuses.push(r.status);
    }
    assert.ok(floodStatuses[0] === 200, 'the first create save is not throttled');
    assert.ok(floodStatuses.includes(429), 'a 62-save burst trips the per-IP rate limiter');
    assert.ok(floodStatuses.slice(-1)[0] === 429, 'the limiter stays tripped at the end of the burst');
    console.log('✔ rate limit: save bursts 429 while normal use passes');
  } finally {
    srv.close();
    fs.rmSync(TMP, { recursive: true, force: true });
  }

  console.log('\nAll project IDOR checks passed.');
}

main().catch((e) => {
  console.error('FAILED:', e);
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(1);
});
