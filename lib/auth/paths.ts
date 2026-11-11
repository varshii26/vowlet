/**
 * Which URLs a signed-out visitor may reach, and where the others send them.
 * Plain strings only (no Node or database imports), so the request proxy can use it.
 */

const PUBLIC_PAGES = ["/login", "/signup"];
/** Auth.js's own endpoints, sign-up, and PayPal's webhook (it is authenticated by its signature, not a session). */
const PUBLIC_API = [/^\/api\/auth(\/|$)/, /^\/api\/register$/, /^\/api\/webhooks\/paypal$/];

export const isPublicPage = (pathname: string) => PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
export const isApiPath = (pathname: string) => pathname === "/api" || pathname.startsWith("/api/");
export const isPublicApi = (pathname: string) => PUBLIC_API.some((p) => p.test(pathname));

/** `/login?next=<where they were going>`; the login page checks `next` again (safeNextPath) before using it. */
export function loginUrl(next: string): string {
  return next === "/" || next === "" ? "/login" : `/login?next=${encodeURIComponent(next)}`;
}

/** Auth.js keeps its session in this cookie (`__Secure-` on https), split into `.0`, `.1` chunks when large. */
export const hasSessionCookie = (names: string[]) => names.some((n) => /^(__Secure-)?authjs\.session-token(\.\d+)?$/.test(n));

export const SESSION_ENDED_MESSAGE = "Your session ended. Sign in again.";
