import { withSession } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { createResetHandler } from "@/lib/demo/reset";
import { createRateLimiter } from "@/lib/rate-limit";

// Module scope: one handler for the life of the server process, so overlapping
// clicks share a reset and the rate limit counts every caller. The endpoint is
// public and wipes the database, so a few resets a minute is plenty for a demo.
const reset = createResetHandler({ prisma, limiter: createRateLimiter({ max: 5, windowMs: 60_000 }) });

// Called only by the "Reset demo" button, after the couple confirms.
async function handlePOST() {
  return reset();
}

export const POST = withSession(handlePOST);
