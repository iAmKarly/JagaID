/**
 * src/lib/rate-limit.ts
 *
 * Tiny in-memory rate limiter. Keyed by an arbitrary string (typically
 * `ip` or `ip:entity_value`). Stores a count + reset timestamp per key.
 *
 * Limitations of in-memory storage on Vercel:
 *   - Each serverless invocation may run in a different container, so the
 *     bucket isn't shared across instances. Determined attackers hitting
 *     many cold instances will see the limit reset per-instance.
 *   - State is lost when the function unloads (no persistence).
 *
 * For dev and small-scale prod this is fine — it deters casual abuse and
 * any user accidentally pressing submit 50 times. For real production
 * scale, swap the implementation for @upstash/ratelimit + Redis (the
 * RateLimitResult shape stays the same).
 */

export interface RateLimitResult {
  ok: boolean;
  /** Calls remaining in the current window. 0 when ok=false. */
  remaining: number;
  /** Seconds until the bucket resets. Used for the `Retry-After` header. */
  resetIn: number;
  /** Full window length in seconds — useful for `X-RateLimit-Reset`. */
  windowSeconds: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Lazy cleanup: evict expired buckets every N calls so the Map doesn't leak
// indefinitely with new IPs. Cheaper than a setInterval which fights HMR.
const CLEANUP_INTERVAL = 1000;
let callCounter = 0;
function maybeCleanup(now: number) {
  if (++callCounter < CLEANUP_INTERVAL) return;
  callCounter = 0;
  for (const [k, v] of buckets) {
    if (v.resetAt < now) buckets.delete(k);
  }
}

/**
 * Increment the counter for `key` and return whether the call is allowed.
 *
 *   const r = rateLimit(`check:${ip}`, 60, 60_000);
 *   if (!r.ok) return new Response("Too many requests", { status: 429 });
 *
 * `max` is the inclusive cap; the (max+1)th call in `windowMs` returns ok=false.
 */
export function rateLimit(key: string, max: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  maybeCleanup(now);

  const bucket = buckets.get(key);
  const windowSeconds = Math.ceil(windowMs / 1000);

  if (!bucket || bucket.resetAt <= now) {
    // Fresh window
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return {
      ok: true,
      remaining: max - 1,
      resetIn: windowSeconds,
      windowSeconds,
    };
  }

  if (bucket.count >= max) {
    return {
      ok: false,
      remaining: 0,
      resetIn: Math.ceil((bucket.resetAt - now) / 1000),
      windowSeconds,
    };
  }

  bucket.count += 1;
  return {
    ok: true,
    remaining: max - bucket.count,
    resetIn: Math.ceil((bucket.resetAt - now) / 1000),
    windowSeconds,
  };
}

/** Test-only helper. Not exported from any production code path. */
export function _resetRateLimitForTests() {
  buckets.clear();
  callCounter = 0;
}
