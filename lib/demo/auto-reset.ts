import type { PrismaClient } from "@/generated/prisma/client";
import { seedDemo } from "@/lib/seed/demo";

/**
 * The hosted demo has one database for every judge, so one judge's changes
 * (a payment, a moved wedding, a pending proposal) would greet the next. When
 * the demo has been changed and then left alone for a while, the first visit
 * after that puts it back to the seed before the page loads.
 *
 * "Changed" and "left alone" both come from the activity log: every change in
 * the app writes an EventLog entry, and a reset writes `demo_seeded`. A demo
 * nobody has changed is never reset, and nobody is reset while they're using it.
 */

export const DEFAULT_IDLE_MINUTES = 30;
/** The activity-feed line an auto-reset leaves, so the next visitor knows what happened. */
export const autoResetMessage = (minutes: number) =>
  `Reset to the starting demo after ${minutes} minute${minutes === 1 ? "" : "s"} without changes`;

/**
 * Minutes of quiet before an auto-reset, from DEMO_AUTO_RESET_MINUTES. "0"
 * switches it off (useful in local development); unset or invalid means 30.
 */
export function idleMinutes(env: string | undefined): number {
  if (env === undefined || env.trim() === "") return DEFAULT_IDLE_MINUTES;
  const n = Number(env);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_IDLE_MINUTES;
}

/** True when the demo has changes and the latest is at least `minutes` old. */
export async function isStale(prisma: PrismaClient, now: Date, minutes: number): Promise<boolean> {
  if (minutes <= 0) return false;
  // Only the demo wedding's own activity counts: real couples using the app never delay or trigger a reset.
  const last = await prisma.eventLog.findFirst({
    where: { wedding: { user: { isDemo: true } } },
    orderBy: { createdAt: "desc" },
    select: { type: true, createdAt: true },
  });
  if (!last || last.type === "demo_seeded") return false; // untouched since the last seed
  return now.getTime() - last.createdAt.getTime() >= minutes * 60_000;
}

type Deps = {
  prisma: PrismaClient;
  /** Minutes of quiet before a reset; 0 switches it off. */
  idleMinutes: number;
  /** Swappable for tests; defaults to the real demo seed. */
  seed?: (prisma: PrismaClient, options: { message?: string }) => Promise<void>;
};

/**
 * Returns a check to run before a page reads the database: resets a stale demo
 * and says whether it did. Visits that arrive during a reset wait for that one
 * instead of starting their own. A failed reset is logged and the page loads
 * the data as it is, so a visit never breaks because of it.
 */
export function createAutoReset(deps: Deps) {
  const seed = deps.seed ?? seedDemo;
  let running: Promise<boolean> | null = null;

  return async function resetIfIdle(now: Date = new Date()): Promise<boolean> {
    running ??= (async () => {
      try {
        if (!(await isStale(deps.prisma, now, deps.idleMinutes))) return false;
        await seed(deps.prisma, { message: autoResetMessage(deps.idleMinutes) });
        console.log("[vowlet] The demo was idle with changes: reset it to the seed.");
        return true;
      } catch (error) {
        console.error("[vowlet] Auto-reset failed:", error);
        return false;
      } finally {
        running = null;
      }
    })();
    return running;
  };
}
