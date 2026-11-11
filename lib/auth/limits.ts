import { createAttemptTracker } from "@/lib/auth/attempts";
import { createRateLimiter } from "@/lib/rate-limit";

/**
 * The sign-in limiters, one set per server process.
 *
 * They live on `globalThis` rather than in module scope because Next bundles the
 * Auth.js API route and the server actions the sign-in form calls separately, and
 * each bundle gets its own copy of a module-level variable. Then a lockout
 * recorded by one path (an attacker hitting /api/auth/callback/credentials
 * directly) would be invisible to the other (the form). One shared set closes that.
 */
type Limits = {
  /** 5 failures per email and 30 per address in 10 minutes: plenty for a typo, far too few for guessing. The address limit is higher because judges at one office share an address. */
  signInAttempts: ReturnType<typeof createAttemptTracker>;
  /** "Try the demo" has no password to guess, but it is public and creates sessions: keep one address from hammering it. */
  demoSignIns: ReturnType<typeof createRateLimiter>;
};

const shared = globalThis as unknown as { __vowletAuthLimits?: Limits };

const limits = (shared.__vowletAuthLimits ??= {
  signInAttempts: createAttemptTracker({ maxPerEmail: 5, maxPerIp: 30, windowMs: 10 * 60_000 }),
  demoSignIns: createRateLimiter({ max: 30, windowMs: 10 * 60_000 }),
});

export const { signInAttempts, demoSignIns } = limits;
