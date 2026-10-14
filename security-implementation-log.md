## Vault Security Implementation Log

### Date: 2025-08-29

### Objective
Implement a secure vault system with passphrase protection using AES-256 and Curve25519 encryption.

### Implementation Details

#### 1. Vault Encryption Service
- Created `src/security/encryption/vault-encryption.service.ts`
- Implemented AES-256-GCM encryption with random IVs and authentication tags
- Added Curve25519 ECDH key exchange for secure key derivation
- Used PBKDF2 with 600,000 iterations for key derivation from passphrases
- Added proper error handling without information leakage

#### 2. Vault Service
- Created `src/security/vault.service.ts`
- Implemented vault state management (enabled/disabled, locked/unlocked)
- Added secure storage of encrypted data with passphrase-based protection
- Used timing-safe comparisons to prevent timing attacks
- Implemented proper memory management (cleared when vault is locked)

#### 3. Vault Controller & Routes
- Created `src/security/vault.controller.ts`
- Implemented REST API endpoints for vault management:
  - `/api/vault/enable` - Enable vault with passphrase
  - `/api/vault/disable` - Disable vault
  - `/api/vault/unlock` - Unlock vault with passphrase
  - `/api/vault/lock` - Lock vault
  - `/api/vault/store` - Store encrypted data
  - `/api/vault/retrieve` - Retrieve encrypted data
  - `/api/vault/status` - Get vault status

#### 4. Vault Setup Service
- Created `src/security/vault.setup.service.ts`
- Added enforcement of 8-digit numeric passcode for initial vault setup
- Implemented validation that passcode must be exactly 8 digits
- Added setup status check to determine if setup is required

#### 5. Security Features
- All sensitive data is encrypted at rest using AES-256
- Passphrases are never stored; only salted hashes are kept
- High iteration count (600,000) for PBKDF2 makes brute force attacks infeasible
- Timing-safe comparisons prevent timing attacks
- Proper error handling that doesn't leak internal details
- Memory is cleared when vault is locked
- Environment variables used for configuration

#### 6. Integration
- Added vault integration in `src/core/vault-integration.ts`
- Updated `index.ts` to include all vault routes and middleware
- Implemented vault middleware to protect sensitive routes
- Added setup endpoints `/api/vault/setup` and `/api/vault/setup-required`

### Changes Made

1. Created new files:
   - `src/security/encryption/vault-encryption.service.ts`
   - `src/security/vault.service.ts`
   - `src/security/vault.controller.ts`
   - `src/security/vault.setup.service.ts`
   - `src/security/vault.middleware.ts`
   - `src/core/vault-integration.ts`

2. Modified files:
   - `index.ts` - Added vault routes, middleware, and setup endpoints

### Security Considerations

The implementation ensures that even with the source code being open, the security of the vault system relies on strong cryptographic principles rather than obscurity. The encryption keys are derived from user-provided passphrases, and without the correct passphrase, the data cannot be decrypted.

### User Flow

1. User visits the application for the first time
2. System detects that vault setup is required via `/api/vault/setup-required`
3. User is prompted to create an 8-digit passcode via `/api/vault/setup`
4. User must enter their passcode to access any vault content
5. All data operations require the user's passcode for encryption/decryption

### Verification

The system was tested to ensure:
- 8-digit passcode is required for initial setup
- Vault operations require passphrase entry
- Data is properly encrypted and decrypted
- Security controls prevent unauthorized access
- Error messages don't leak sensitive information

### Status
Implementation complete and verified.
---

## 2026-10-14 — External audit remediation: project write authorization, generated-code sandbox, save throttling

### Findings addressed

An external security/UX audit of the v1.4.0 tree confirmed three code-level
gaps, all fixed here:

1. `POST /api/project/save` accepted an existing project `id` from any caller
   and overwrote the files — no token check, and the save-time `ownerToken`
   written into `manifest.json` was never read anywhere, so an attacker who
   learned an id could replace every file and re-stamp the manifest.
2. `checkProjectOwnership()` treated any currently-valid vault token as the
   owner. That token is an instance-wide HMAC, so on a shared instance every
   user mints the SAME token and it cannot tell users apart.
3. Generated `server.js` backends ran as unsandboxed children: the env
   allowlist hid secrets, but the code could read ENZO's own files (`.env`,
   `memory-store.json`, other projects) and spawn arbitrary processes.

### Changes Made

1. `src/projects/project.ts` — save-over gate + device ownership:
   - Upserting into an EXISTING project now requires a valid vault token
     AND a match on the manifest's recorded `ownerId` (the creator's
     `x-enzo-owner` device id). New/anonymous creation stays open (the
     returned id is the grant, same capability model as /api/preview).
   - Legacy projects (no recorded owner) keep the token-only grant; the
     first authorized updater claims the device id, later devices 403.
   - Updates never clobber a recorded owner; delete/manifest gated the
     same way via `requireProjectOwnership`.
2. `src/lib/enzoOwner.ts` (frontend) + `TerminalSection.tsx` — browsers
   persist a random device id and send it as `x-enzo-owner` on project
   save/delete; project DELETEs now actually carry the vault token (they
   previously sent neither header, so server-side cleanup always 403'd).
3. `src/projects/project-runtime.ts` + `src/core/build-verify.ts` —
   generated backends (live runtime AND boot checks) spawn under
   `node --permission`: fs reads restricted to the project dir +
   node_modules + /etc + $TMPDIR, writes to project dir + $TMPDIR,
   child_process denied, `--allow-addons` open for better-sqlite3.
   Flag support probed once; a permission-denied boot retries once
   without the sandbox; `ENZO_RUNTIME_PERMISSIONS=0` opts out entirely.
4. `src/core/rate-limit.ts` (extracted verbatim from index.ts) —
   `/api/project/save` is now rate-limited (60/min per IP); index.ts
   imports the shared limiter.

### What is deliberately NOT fixed here

- Network egress from generated backends: the Node permission model does
  not cover sockets. OS/container-level isolation is the roadmap item.

### Follow-up (same day): chat-context read gate

The chat pipeline injected another project's files whenever a request named
its `projectId` — an id-holder could pull another user's code into their own
model context. `checkProjectReadAccess()` (read-side twin of the save gate)
now requires the recorded `x-enzo-owner` device id on recorded-owner
projects; legacy/anonymous projects keep the id-as-capability grant. The
frontend chat request sends the device id header.

### Verification

- `tests/project-idor.test.ts` extended: anonymous/wrong-token/cross-device
  save-overs 403 with files untouched, owner update lands in the same
  container, legacy claim sticks, delete/manifest device-gated, CSP sandbox
  header present, 62-save burst trips the rate limiter. Full suite green.
