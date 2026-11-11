import { registrations } from "@/lib/auth/limits";
import { createRegisterHandler } from "@/lib/auth/register-handler";
import { prisma } from "@/lib/db";

// The limiter is shared with the sign-up form (lib/auth/limits.ts), so neither path is a way around the other's limit.
const register = createRegisterHandler({ prisma, limiter: registrations });

export async function POST(request: Request) {
  return register(request);
}
