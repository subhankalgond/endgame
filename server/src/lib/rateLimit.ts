/** Small fixed-window in-memory rate limiter keyed by arbitrary string. */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSec: Math.ceil(windowMs / 1000) };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return { allowed: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  return { allowed: true, remaining: limit - bucket.count, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
}

export function resetRateLimits(): void {
  buckets.clear();
}

/** Periodically drop expired buckets so memory stays bounded. */
export function startRateLimitSweeper(): NodeJS.Timeout {
  return setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, 60_000);
}
