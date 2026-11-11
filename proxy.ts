import { NextResponse, type NextRequest } from "next/server";
import { hasSessionCookie, isApiPath, isPublicApi, isPublicPage, loginUrl, SESSION_ENDED_MESSAGE } from "@/lib/auth/paths";

/**
 * The first line of defence: a request with no session cookie never reaches an app
 * page or API route. It only looks for the cookie, which is cheap but can't tell a
 * valid session from an expired one, so every page and API route checks the session
 * again on the server (lib/auth/guard.ts). Don't rely on this file alone.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isPublicPage(pathname) || isPublicApi(pathname)) return NextResponse.next();
  if (hasSessionCookie(request.cookies.getAll().map((c) => c.name))) return NextResponse.next();

  if (isApiPath(pathname)) {
    return NextResponse.json({ ok: false, error: { code: "unauthorized", message: SESSION_ENDED_MESSAGE } }, { status: 401 });
  }
  return NextResponse.redirect(new URL(loginUrl(`${pathname}${search}`), request.url));
}

export const config = {
  // Pages and API routes only: not Next's own assets or the icon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\.(?:png|jpg|jpeg|gif|svg|ico|webp|pdf|css|js|map)$).*)"],
};
