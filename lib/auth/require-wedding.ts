import "server-only";
import { redirect } from "next/navigation";
import { requestScope, type RequestScope } from "@/lib/auth/request-wedding";

/** Where a signed-in user with no wedding is sent to create one. */
export const ONBOARDING_PATH = "/onboarding";

/**
 * For pages that need a wedding: a signed-in user who hasn't created one yet is
 * sent to onboarding, from any page. (Signed-out visitors still see the shared demo
 * until #105 sends them to /login.) Returns the request's user and wedding.
 */
export async function requireWeddingOrOnboarding(): Promise<RequestScope> {
  const scope = await requestScope();
  if (scope.userId && !scope.weddingId) redirect(ONBOARDING_PATH);
  return scope;
}
