import type { PrismaClient } from "@/generated/prisma/client";
import type { RateLimiter } from "@/lib/rate-limit";
import { seedDemo } from "@/lib/seed/demo";

type Deps = {
  prisma: PrismaClient;
  limiter: RateLimiter;
  /** Swappable for tests; defaults to the real demo seed. */
  seed?: (prisma: PrismaClient) => Promise<void>;
};

const fail = (status: number, code: string, message: string, headers?: HeadersInit) =>
  Response.json({ ok: false, error: { code, message } }, { status, headers });

/**
 * POST /api/demo/reset: wipe the database and reload the Priya & Sam demo, so
 * judges always start from the same state (no extra paid payments, no
 * proposals, the original wedding date).
 *
 * Safe to click repeatedly: the seed runs in one transaction, so a failure
 * leaves the data as it was, and clicks that arrive while a reset is running
 * share it instead of starting their own. The endpoint is public, so it is
 * rate limited like the agent.
 */
export function createResetHandler(deps: Deps) {
  const seed = deps.seed ?? seedDemo;
  let running: Promise<void> | null = null;

  return async function resetHandler(): Promise<Response> {
    if (!running) {
      const limit = deps.limiter.check();
      if (!limit.allowed) {
        const seconds = Math.max(1, Math.ceil(limit.retryAfterMs / 1000));
        return fail(429, "too_many_requests", `The demo was reset a moment ago. Try again in ${seconds} seconds.`, {
          "Retry-After": String(seconds),
        });
      }
      running = seed(deps.prisma).finally(() => {
        running = null;
      });
    }

    try {
      await running;
    } catch (error) {
      console.error("[vowlet] Demo reset failed:", error);
      return fail(500, "reset_failed", "Couldn't reset the demo. Please try again.");
    }
    return Response.json({ ok: true, message: "The demo is back to its starting state." });
  };
}
