import { describe, expect, it } from "vitest";
import { DEFAULT_AFTER_SIGN_IN, safeNextPath } from "@/lib/auth/redirect";

describe("safeNextPath", () => {
  it("keeps a path on this site, with its query and fragment", () => {
    expect(safeNextPath("/vendors/abc")).toBe("/vendors/abc");
    expect(safeNextPath("/vendors/abc?clause=c1")).toBe("/vendors/abc?clause=c1");
    expect(safeNextPath("/upload#samples")).toBe("/upload#samples");
    expect(safeNextPath("/")).toBe("/");
  });

  it("falls back to the dashboard when there is nothing", () => {
    for (const value of [undefined, null, "", []]) expect(safeNextPath(value as never)).toBe(DEFAULT_AFTER_SIGN_IN);
    expect(DEFAULT_AFTER_SIGN_IN).toBe("/");
  });

  it("uses the first value when a parameter is repeated", () => {
    expect(safeNextPath(["/upload", "https://evil.example"])).toBe("/upload");
    expect(safeNextPath(["https://evil.example", "/upload"])).toBe("/");
  });

  it("rejects every way of leaving the site", () => {
    for (const evil of [
      "https://evil.example",
      "http://evil.example/path",
      "//evil.example",
      "///evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "/\\/evil.example",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "evil.example",
      "vendors/abc", // relative: not rooted
      "/\t/evil.example", // browsers strip the tab, leaving //evil.example
      "/\n/evil.example",
      "/\r\n/evil.example",
      "/%0d%0aSet-Cookie: x=1", // fine as an encoded path, but see the next test
    ]) {
      const result = safeNextPath(evil);
      expect(result === DEFAULT_AFTER_SIGN_IN || result.startsWith("/%0d")).toBe(true);
      expect(result.startsWith("//"), evil).toBe(false);
    }
  });

  it("never returns a URL that resolves to another origin", () => {
    for (const input of ["/..//evil.example", "/a/../../evil.example", "/%2f%2fevil.example", "/.//evil.example"]) {
      const result = safeNextPath(input);
      expect(new URL(result, "http://vowlet.invalid").origin, input).toBe("http://vowlet.invalid");
    }
  });

  it("does not send people back to the auth pages (a loop) or to API routes", () => {
    for (const path of ["/login", "/login?next=/", "/login/", "/signup", "/signup?x=1", "/api/auth/signout", "/api/demo/reset", "/api"]) {
      expect(safeNextPath(path), path).toBe("/");
    }
    // But a page whose name merely starts the same way is fine.
    expect(safeNextPath("/loginfo")).toBe("/loginfo");
  });

  it("refuses absurdly long values", () => {
    expect(safeNextPath(`/${"a".repeat(2001)}`)).toBe("/");
  });
});
