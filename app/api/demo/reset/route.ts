import { withSession } from "@/lib/auth/guard";
import { requestScope } from "@/lib/auth/request-wedding";
import { prisma } from "@/lib/db";
import { createResetHandler } from "@/lib/demo/reset";
import { createRateLimiter } from "@/lib/rate-limit";

// Module scope: one handler for the life of the server process, so overlapping
// clicks share a reset and the rate limit counts every caller. The endpoint is
// public and wipes the database, so a few resets a minute is plenty for a demo.
const reset = createResetHandler({ prisma, limiter: createRateLimiter({ max: 5, windowMs: 60_000 }) });

// Called only by the "Reset demo" button, after the visitor confirms. It reseeds the demo wedding, so only the
// demo account may call it: a real couple gets 403 and nothing happens. (It never touches their data either way.)
async function handlePOST() {
  const { isDemo } = await requestScope();
  if (!isDemo) {
    return Response.json({ ok: false, error: { code: "demo_only", message: "Only the demo account can reset the demo." } }, { status: 403 });
  }
  return reset();
}

export const POST = withSession(handlePOST);
