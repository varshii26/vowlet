import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "@/proxy";

const request = (path: string, cookie?: string) => new NextRequest(`http://localhost:3000${path}`, cookie ? { headers: { cookie } } : undefined);
const SESSION = "authjs.session-token=abc";
const passes = (res: Response) => res.headers.get("x-middleware-next") === "1";

describe("proxy, signed out", () => {
  it.each(["/", "/upload", "/onboarding", "/vendors/abc"])("sends %s to /login with the page as next", (path) => {
    const res = proxy(request(path));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe(path === "/" ? null : path);
  });

  it("keeps the query string in next", () => {
    const location = new URL(proxy(request("/vendors/abc?clause=c1")).headers.get("location")!);
    expect(location.searchParams.get("next")).toBe("/vendors/abc?clause=c1");
  });

  it("answers 401 with the session-ended message to API calls, not a redirect", async () => {
    const res = proxy(request("/api/agent"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: { code: "unauthorized", message: "Your session ended. Sign in again." } });
  });

  it.each(["/login", "/signup", "/api/auth/session", "/api/register", "/api/webhooks/paypal"])("lets %s through", (path) => {
    expect(passes(proxy(request(path)))).toBe(true);
  });
});

describe("proxy, with a session cookie", () => {
  it.each(["/", "/upload", "/api/agent"])("lets %s through (the page or route checks the session itself)", (path) => {
    expect(passes(proxy(request(path, SESSION)))).toBe(true);
  });
});
