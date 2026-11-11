import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Whose wedding a request is about. Every page and API route that shows or
 * changes wedding data starts from this, so a signed-in couple only ever works
 * on their own wedding, never "the first one in the database".
 *
 * - Signed in: that user's wedding (one per user), or null if they haven't set one up (they go to onboarding).
 * - Signed out: nothing. Signed-out visitors are sent to /login; the demo is the demo *user's* wedding.
 */
export async function weddingIdFor(prisma: PrismaClient, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const wedding = await prisma.wedding.findUnique({ where: { userId }, select: { id: true } });
  return wedding?.id ?? null;
}
