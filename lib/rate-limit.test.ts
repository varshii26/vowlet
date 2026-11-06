import { describe, expect, it } from "vitest";
import { createRateLimiter } from "@/lib/rate-limit";

function limiter(max: number, windowMs: number) {
  let time = 1_000_000;
  const l = createRateLimiter({ max, windowMs, now: () => time });
  return { ...l, advance: (ms: number) => (time += ms) };
}

describe("createRateLimiter", () => {
  it("allows up to the maximum, then refuses", () => {
    const l = limiter(3, 60_000);
    expect([l.check(), l.check(), l.check()].every((r) => r.allowed)).toBe(true);
    expect(l.check().allowed).toBe(false);
  });

  it("says how long to wait, counted from the oldest request", () => {
    const l = limiter(2, 60_000);
    l.check();
    l.advance(10_000);
    l.check();
    l.advance(5_000);
    expect(l.check()).toEqual({ allowed: false, retryAfterMs: 45_000 });
  });

  it("lets requests through again as the window slides", () => {
    const l = limiter(2, 60_000);
    l.check();
    l.advance(30_000);
    l.check();
    expect(l.check().allowed).toBe(false);
    l.advance(30_001); // the first request has now left the window
    expect(l.check().allowed).toBe(true);
    expect(l.check().allowed).toBe(false);
  });

  it("does not count refused requests against the caller", () => {
    const l = limiter(1, 1_000);
    l.check();
    for (let i = 0; i < 5; i++) expect(l.check().allowed).toBe(false);
    l.advance(1_001);
    expect(l.check().allowed).toBe(true);
  });

  it("limits each key separately", () => {
    const l = limiter(1, 60_000);
    expect(l.check("a").allowed).toBe(true);
    expect(l.check("b").allowed).toBe(true);
    expect(l.check("a").allowed).toBe(false);
  });

  it("shares one limit by default", () => {
    const l = limiter(1, 60_000);
    l.check();
    expect(l.check().allowed).toBe(false);
  });
});
