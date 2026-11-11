import "server-only";
import { prisma } from "@/lib/db";
import { createAutoReset, idleMinutes } from "@/lib/demo/auto-reset";

/**
 * The server's one auto-reset check (lib/demo/auto-reset.ts), so visits that
 * arrive together share a reset. Called by the dashboard before it reads data.
 */
export const resetIfIdle = createAutoReset({ prisma, idleMinutes: idleMinutes(process.env.DEMO_AUTO_RESET_MINUTES) });
