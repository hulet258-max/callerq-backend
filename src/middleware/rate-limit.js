import { AppError } from '../utils/app-error.js';

const buckets = new Map();

export function rateLimit({ windowMs = 15 * 60_000, max = 30, keys = [(req) => `ip:${req.ip}`] } = {}) {
  return (req, _res, next) => {
    const now = Date.now();
    const resolved = keys.map((key) => key(req)).filter(Boolean);
    for (const key of resolved) {
      const bucket = buckets.get(key);
      if (bucket && bucket.resetAt > now && bucket.count >= max) {
        return next(new AppError('Too many attempts. Please try again later.', 429));
      }
    }
    for (const key of resolved) {
      const bucket = buckets.get(key);
      buckets.set(key, !bucket || bucket.resetAt <= now
        ? { count: 1, resetAt: now + windowMs }
        : { ...bucket, count: bucket.count + 1 });
    }
    next();
  };
}

export function clearRateLimits() { buckets.clear(); }
