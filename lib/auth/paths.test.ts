import { describe, expect, it } from "vitest";
import { hasSessionCookie, isApiPath, isPublicApi, isPublicPage, loginUrl } from "@/lib/auth/paths";
import { safeNextPath } from "@/lib/auth/redirect";

describe("loginUrl", () => {
  it("carries the page they were going to", () => {
    expect(loginUrl("/vendors/abc?clause=c1")).toBe("/login?next=%2Fvendors%2Fabc%3Fclause%3Dc1");
  });
  it("is plain /login for the dashboard, which is the default anyway", () => {
    expect(loginUrl("/")).toBe("/login");
  });
  it("round-trips through the same check the login page applies", () => {
    expect(safeNextPath(decodeURIComponent(loginUrl("/upload").split("next=")[1]))).toBe("/upload");
  });
});

describe("public paths", () => {
  it.each(["/login", "/signup", "/login/"])("page %s is public", (p) => expect(isPublicPage(p)).toBe(true));
  it.each(["/", "/upload", "/onboarding", "/vendors/x", "/loginx", "/signup-now"])("page %s needs a session", (p) => expect(isPublicPage(p)).toBe(false));
  it.each(["/api/auth/session", "/api/auth/callback/google", "/api/register", "/api/webhooks/paypal"])("api %s is public", (p) => expect(isPublicApi(p)).toBe(true));
  it.each(["/api/agent", "/api/demo/reset", "/api/register/x", "/api/authx", "/api/webhooks/paypal/extra", "/api/whatif/apply"])("api %s needs a session", (p) =>
    expect(isPublicApi(p)).toBe(false),
  );
  it("tells API paths from pages", () => {
    expect(isApiPath("/api/agent")).toBe(true);
    expect(isApiPath("/apiary")).toBe(false);
  });
});

describe("hasSessionCookie", () => {
  it("accepts the Auth.js session cookie, secure and chunked variants included", () => {
    for (const n of ["authjs.session-token", "__Secure-authjs.session-token", "authjs.session-token.0"]) expect(hasSessionCookie(["x", n])).toBe(true);
  });
  it("is not fooled by other cookies", () => {
    for (const n of ["authjs.csrf-token", "authjs.callback-url", "session-token", "xauthjs.session-token"]) expect(hasSessionCookie([n])).toBe(false);
  });
});
