/**
 * Slows down password guessing: too many FAILED sign-ins for one email, or from
 * one address, and further attempts are refused for a while, even with the right
 * password. In memory and per server process, like the app's other limiters
 * (right for one Render instance).
 *
 * It counts failures only, so a person who signs in normally is never counted.
 * A success clears that email's count. The address keeps its count: one address
 * guessing at many different emails is exactly what the per-address limit is for.
 */

type Options = {
  maxPerEmail: number;
  maxPerIp: number;
  windowMs: number;
  now?: () => number;
};

export type AttemptStatus = { blocked: false } | { blocked: true; retryAfterMs: number };

/** Entries are pruned past this many, so spraying random emails can't grow memory without limit. */
const MAX_KEYS = 10_000;

export function createAttemptTracker(options: Options) {
  const now = options.now ?? Date.now;
  const failures = new Map<string, number[]>();

  const recent = (key: string, t: number) => (failures.get(key) ?? []).filter((time) => t - time < options.windowMs);

  function blockedFor(key: string, max: number, t: number): number | null {
    const hits = recent(key, t);
    return hits.length >= max ? options.windowMs - (t - hits[0]) : null;
  }

  function prune(t: number) {
    if (failures.size <= MAX_KEYS) return;
    for (const [key, hits] of failures) {
      if (!hits.some((time) => t - time < options.windowMs)) failures.delete(key);
    }
  }

  return {
    /** Whether this email or address is currently locked out, and for how long. */
    status(email: string, ip: string): AttemptStatus {
      const t = now();
      const waits = [blockedFor(`email:${email}`, options.maxPerEmail, t), blockedFor(`ip:${ip}`, options.maxPerIp, t)].filter((w): w is number => w !== null);
      return waits.length ? { blocked: true, retryAfterMs: Math.max(...waits) } : { blocked: false };
    },

    /** Count a failed sign-in against the email and the address. */
    fail(email: string, ip: string): void {
      const t = now();
      for (const key of [`email:${email}`, `ip:${ip}`]) failures.set(key, [...recent(key, t), t]);
      prune(t);
    },

    /** A successful sign-in clears the email's failures. */
    succeed(email: string): void {
      failures.delete(`email:${email}`);
    },
  };
}

export type AttemptTracker = ReturnType<typeof createAttemptTracker>;
