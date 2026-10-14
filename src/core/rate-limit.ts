/**
 * rate-limit.ts — the shared in-memory per-IP fixed-window limiter.
 *
 * Extracted from index.ts verbatim so projects/project.ts can throttle
 * /api/project/save without importing index.ts back (circular — the same
 * reason vault-token.ts lives in its own module).
 *
 * ponytail: one Map in this process, so limits are per-instance and reset on
 * restart. Correct for the single-instance deployment this ships as, and it
 * keeps Redis out of the dependency list. The moment there are two instances
 * behind one hostname a client gets N× the limit — that is the trigger to move
 * the bucket into a shared store, not before.
 */
import type { NextFunction, Request, Response } from 'express';

const RATE_LIMIT_BUCKETS = new Map<string, { count: number; reset: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of RATE_LIMIT_BUCKETS) {
    if (v.reset <= now) RATE_LIMIT_BUCKETS.delete(k);
  }
}, 60_000).unref();

export function rateLimit(bucket: string, maxPerMin: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const id = `${bucket}:${ip}`;
    const now = Date.now();
    let slot = RATE_LIMIT_BUCKETS.get(id);
    if (!slot || slot.reset <= now) {
      slot = { count: 0, reset: now + 60_000 };
      RATE_LIMIT_BUCKETS.set(id, slot);
    }
    slot.count += 1;
    if (slot.count > maxPerMin) {
      res.status(429).json({ error: 'rate_limited' });
      return;
    }
    next();
  };
}
