import "server-only";
import { redirect } from "next/navigation";
import { loginUrl } from "@/lib/auth/paths";
import { requestScope } from "@/lib/auth/request-wedding";

/** Where a signed-in user with no wedding is sent to create one. */
export const ONBOARDING_PATH = "/onboarding";

/**
 * For pages that need a wedding. Signed out: to /login, coming back to `next` after.
 * Signed in with no wedding yet: to onboarding, from any page. Otherwise the user and their wedding.
 */
export async function requireWeddingOrOnboarding(next: string): Promise<{ userId: string; weddingId: string; isDemo: boolean }> {
  const { userId, weddingId, isDemo } = await requestScope();
  if (!userId) redirect(loginUrl(next));
  if (!weddingId) redirect(ONBOARDING_PATH);
  return { userId, weddingId, isDemo };
}
