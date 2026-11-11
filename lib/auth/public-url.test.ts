import { describe, expect, it } from "vitest";
import { applyPublicUrl, publicUrl } from "@/lib/auth/public-url";
import { isCrossSiteRequest } from "@/lib/auth/origin";

describe("publicUrl", () => {
  it("prefers AUTH_URL, then NEXTAUTH_URL, then Render's own address, as an origin", () => {
    expect(publicUrl({ AUTH_URL: "https://vowlet.onrender.com/", RENDER_EXTERNAL_URL: "https://other.onrender.com" })).toBe("https://vowlet.onrender.com");
    expect(publicUrl({ NEXTAUTH_URL: "https://a.example", RENDER_EXTERNAL_URL: "https://b.example" })).toBe("https://a.example");
    expect(publicUrl({ RENDER_EXTERNAL_URL: "https://vowlet.onrender.com" })).toBe("https://vowlet.onrender.com");
  });
  it("is null locally, and for a blank or broken value", () => {
    expect(publicUrl({})).toBeNull();
    expect(publicUrl({ AUTH_URL: "  ", RENDER_EXTERNAL_URL: "" })).toBeNull();
    expect(publicUrl({ AUTH_URL: "not a url" })).toBeNull();
  });
});

describe("applyPublicUrl", () => {
  it("fills in a missing or blank AUTH_URL from Render's address, and never overrides one that is set", () => {
    const env: Record<string, string | undefined> = { RENDER_EXTERNAL_URL: "https://vowlet.onrender.com" };
    applyPublicUrl(env);
    expect(env.AUTH_URL).toBe("https://vowlet.onrender.com");
    const blank: Record<string, string | undefined> = { AUTH_URL: " ", RENDER_EXTERNAL_URL: "https://vowlet.onrender.com" };
    applyPublicUrl(blank);
    expect(blank.AUTH_URL).toBe("https://vowlet.onrender.com");
    const set: Record<string, string | undefined> = { AUTH_URL: "https://custom.example", RENDER_EXTERNAL_URL: "https://vowlet.onrender.com" };
    applyPublicUrl(set);
    expect(set.AUTH_URL).toBe("https://custom.example");
  });
  it("does nothing locally", () => {
    const env: Record<string, string | undefined> = {};
    applyPublicUrl(env);
    expect(env.AUTH_URL).toBeUndefined();
  });
});

describe("the cross-site check behind a proxy that shows an internal host", () => {
  const post = (origin: string) => new Request("https://localhost:10000/api/x", { method: "POST", headers: { Host: "localhost:10000", Origin: origin } });
  it("accepts the public address when RENDER_EXTERNAL_URL is set, and still refuses other sites", () => {
    process.env.RENDER_EXTERNAL_URL = "https://vowlet.onrender.com";
    try {
      expect(isCrossSiteRequest(post("https://vowlet.onrender.com"))).toBe(false);
      expect(isCrossSiteRequest(post("https://evil.example"))).toBe(true);
      expect(isCrossSiteRequest(post("https://vowlet.onrender.com.evil.example"))).toBe(true);
    } finally {
      delete process.env.RENDER_EXTERNAL_URL;
    }
  });
  it("without it, the public address looks like another site (the failure this guards against)", () => {
    expect(isCrossSiteRequest(post("https://vowlet.onrender.com"))).toBe(true);
  });
});
