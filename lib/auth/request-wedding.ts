import "server-only";
import { auth } from "@/lib/auth";
import { weddingIdFor } from "@/lib/auth/wedding";
import { prisma } from "@/lib/db";

export type RequestScope = {
  /** The signed-in user, or null when signed out. */
  userId: string | null;
  /** Their wedding, or null if they haven't created one yet. */
  weddingId: string | null;
  /** True for the shared demo account. */
  isDemo: boolean;
};

/** The signed-in user and wedding for the current request. Both are null when signed out. */
export async function requestScope(): Promise<RequestScope> {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  return { userId, weddingId: await weddingIdFor(prisma, userId), isDemo: session?.user?.isDemo ?? false };
}

/** For API routes: the wedding id of the current request, or null. */
export const requestWeddingId = async () => (await requestScope()).weddingId;
