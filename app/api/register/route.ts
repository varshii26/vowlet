import { createRegisterHandler } from "@/lib/auth/register-handler";
import { prisma } from "@/lib/db";
import { createRateLimiter } from "@/lib/rate-limit";

// Module scope: one limiter for the life of the server process. 10 sign-ups per caller per 10 minutes is plenty for a person.
const register = createRegisterHandler({ prisma, limiter: createRateLimiter({ max: 10, windowMs: 10 * 60_000 }) });

export async function POST(request: Request) {
  return register(request);
}
