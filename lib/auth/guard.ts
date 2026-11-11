import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { crossSiteResponse, isCrossSiteRequest } from "@/lib/auth/origin";
import { loginUrl, SESSION_ENDED_MESSAGE } from "@/lib/auth/paths";

/** A page that needs a signed-in user: signed-out visitors go to /login and come back to `next` afterwards. */
export async function requireUser(next: string): Promise<{ id: string; isDemo: boolean }> {
  const session = await auth();
  if (!session?.user?.id) redirect(loginUrl(next));
  return { id: session.user.id, isDemo: session.user.isDemo ?? false };
}

/** 401 in the shape every API error uses, so the browser shows the message in place. */
export const unauthorized = () =>
  Response.json({ ok: false, error: { code: "unauthorized", message: SESSION_ENDED_MESSAGE } }, { status: 401 });

/**
 * Wraps an API route handler so it only runs for a signed-in user, and (for anything that
 * changes state) only for a request from this site. This is the check that counts: the
 * proxy only sees the cookie, not whether the session is still valid.
 */
export function withSession<Args extends [Request, ...unknown[]]>(handler: (...args: Args) => Promise<Response> | Response) {
  return async (...args: Args): Promise<Response> => {
    // Cross-site first: a forged request learns nothing, not even whether the session is valid.
    if (isCrossSiteRequest(args[0])) return crossSiteResponse();
    const session = await auth();
    if (!session?.user?.id) return unauthorized();
    return handler(...args);
  };
}
