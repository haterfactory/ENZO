/**
 * enzoOwner.ts — the device identity behind project ownership.
 *
 * The vault session token is instance-wide (every browser on the same ENZO
 * instance mints the same per-window HMAC), so it cannot tell two users of a
 * shared instance apart. Each browser therefore owns a random device id,
 * persisted in localStorage and sent as the `x-enzo-owner` header on project
 * save/delete/manifest calls; the backend records it in the project's
 * manifest.json and requires a match before anything else writes into that
 * project (see src/projects/project.ts). The private-browsing fallback keeps
 * one shared constant so incognito sessions keep working the way they did
 * before device ownership existed.
 */

const STORAGE_KEY = 'enzo.ownerId';
const INCOGNITO_FALLBACK = 'incognito-session';

export function getEnzoOwnerId(): string {
  try {
    let id = localStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  } catch {
    return INCOGNITO_FALLBACK;
  }
}
