/**
 * A sliding-window limiter, in memory. It protects the free AI quota from a
 * public demo being hammered. It is per server process, which is right for one
 * Render instance; it would not be shared across several.
 */
export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterMs: number };

export function createRateLimiter(options: { max: number; windowMs: number; now?: () => number }) {
  const now = options.now ?? Date.now;
  const hits = new Map<string, number[]>();

  return {
    /** Count a request for `key`. Returns whether it is allowed and, if not, how long to wait. */
    check(key = "global"): RateLimitResult {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((time) => t - time < options.windowMs);
      if (recent.length >= options.max) {
        hits.set(key, recent);
        return { allowed: false, retryAfterMs: options.windowMs - (t - recent[0]) };
      }
      recent.push(t);
      hits.set(key, recent);
      return { allowed: true };
    },
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;
