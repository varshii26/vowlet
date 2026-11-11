import { describe, expect, it } from "vitest";
import { isCrossSiteRequest } from "@/lib/auth/origin";

const req = (method: string, headers: Record<string, string> = {}) => new Request("http://localhost:3000/api/x", { method, headers });

describe("isCrossSiteRequest", () => {
  it("never blocks reads", () => {
    expect(isCrossSiteRequest(req("GET", { Origin: "https://evil.example" }))).toBe(false);
    expect(isCrossSiteRequest(req("HEAD", { "Sec-Fetch-Site": "cross-site" }))).toBe(false);
  });

  it("blocks a state-changing request whose Origin is another site", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(isCrossSiteRequest(req(method, { Host: "vowlet.onrender.com", Origin: "https://evil.example" })), method).toBe(true);
    }
  });

  it("allows the site's own Origin, including behind a proxy that forwards the host", () => {
    expect(isCrossSiteRequest(req("POST", { Host: "localhost:3000", Origin: "http://localhost:3000" }))).toBe(false);
    expect(isCrossSiteRequest(req("POST", { Host: "10.0.0.5:10000", "X-Forwarded-Host": "vowlet.onrender.com", Origin: "https://vowlet.onrender.com" }))).toBe(false);
  });

  it("blocks look-alike hosts and unparseable or null origins", () => {
    for (const origin of ["https://vowlet.onrender.com.evil.example", "https://evilvowlet.onrender.com", "null", "not a url", "http://localhost:3001"]) {
      expect(isCrossSiteRequest(req("POST", { "X-Forwarded-Host": "vowlet.onrender.com", Host: "localhost:3000", Origin: origin })), origin).toBe(true);
    }
  });

  it("falls back to Sec-Fetch-Site when there is no Origin", () => {
    expect(isCrossSiteRequest(req("POST", { "Sec-Fetch-Site": "cross-site" }))).toBe(true);
    expect(isCrossSiteRequest(req("POST", { "Sec-Fetch-Site": "same-site" }))).toBe(true);
    expect(isCrossSiteRequest(req("POST", { "Sec-Fetch-Site": "same-origin" }))).toBe(false);
    expect(isCrossSiteRequest(req("POST", { "Sec-Fetch-Site": "none" }))).toBe(false);
  });

  it("allows a request with neither header (curl, server to server): it still needs a session", () => {
    expect(isCrossSiteRequest(req("POST"))).toBe(false);
  });
});
