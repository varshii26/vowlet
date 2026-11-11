import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Whose wedding a request is about. Every page and API route that shows or
 * changes wedding data starts from this, so a signed-in couple only ever works
 * on their own wedding, never "the first one in the database".
 *
 * - Signed in: that user's wedding (one per user), or null if they haven't set one up (they go to onboarding).
 * - Signed out: the shared Priya & Sam demo wedding. That is only the case until #105 sends
 *   signed-out visitors to /login; until then the public demo keeps working as it always has.
 */
export async function weddingIdFor(prisma: PrismaClient, userId: string | null): Promise<string | null> {
  const wedding = await prisma.wedding.findFirst({
    where: userId ? { userId } : { user: { isDemo: true } },
    select: { id: true },
  });
  return wedding?.id ?? null;
}
