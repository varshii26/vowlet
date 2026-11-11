import { describe, expect, it } from "vitest";
import { createAttemptTracker } from "@/lib/auth/attempts";

function setup(over: Partial<Parameters<typeof createAttemptTracker>[0]> = {}) {
  let t = 1_000_000;
  const tracker = createAttemptTracker({ maxPerEmail: 3, maxPerIp: 5, windowMs: 60_000, now: () => t, ...over });
  return { tracker, advance: (ms: number) => (t += ms) };
}

describe("createAttemptTracker", () => {
  it("allows a fresh email and address", () => {
    expect(setup().tracker.status("a@b.co", "1.1.1.1")).toEqual({ blocked: false });
  });

  it("locks an email after too many failures, and says how long to wait", () => {
    const { tracker, advance } = setup();
    for (let i = 0; i < 3; i++) {
      expect(tracker.status("a@b.co", "1.1.1.1").blocked).toBe(false);
      tracker.fail("a@b.co", "1.1.1.1");
      advance(1_000);
    }
    const status = tracker.status("a@b.co", "1.1.1.1");
    expect(status).toEqual({ blocked: true, retryAfterMs: 57_000 }); // the first failure was 3s ago, in a 60s window
  });

  it("frees the email once the window has passed", () => {
    const { tracker, advance } = setup();
    for (let i = 0; i < 3; i++) tracker.fail("a@b.co", "1.1.1.1");
    expect(tracker.status("a@b.co", "1.1.1.1").blocked).toBe(true);
    advance(60_001);
    expect(tracker.status("a@b.co", "1.1.1.1")).toEqual({ blocked: false });
  });

  it("locks the address when it guesses at many different emails, even though no single email is locked", () => {
    const { tracker } = setup();
    for (let i = 0; i < 5; i++) tracker.fail(`user${i}@b.co`, "9.9.9.9");
    expect(tracker.status("fresh@b.co", "9.9.9.9").blocked).toBe(true);
    expect(tracker.status("fresh@b.co", "8.8.8.8")).toEqual({ blocked: false }); // someone else is fine
  });

  it("keeps one email's lock from affecting another", () => {
    const { tracker } = setup();
    for (let i = 0; i < 3; i++) tracker.fail("victim@b.co", "1.1.1.1");
    expect(tracker.status("victim@b.co", "2.2.2.2").blocked).toBe(true);
    expect(tracker.status("other@b.co", "2.2.2.2").blocked).toBe(false);
  });

  it("clears an email's failures on a successful sign-in, but not the address's", () => {
    const { tracker } = setup({ maxPerIp: 4 });
    tracker.fail("a@b.co", "1.1.1.1");
    tracker.fail("a@b.co", "1.1.1.1");
    tracker.succeed("a@b.co");
    tracker.fail("a@b.co", "1.1.1.1");
    expect(tracker.status("a@b.co", "1.1.1.1").blocked).toBe(false); // the email is back to one failure
    tracker.fail("b@b.co", "1.1.1.1");
    expect(tracker.status("c@b.co", "1.1.1.1").blocked).toBe(true); // but the address has now failed four times
  });

  it("does not count anything until fail() is called, so ordinary sign-ins are free", () => {
    const { tracker } = setup();
    for (let i = 0; i < 100; i++) expect(tracker.status("a@b.co", "1.1.1.1").blocked).toBe(false);
  });

  it("waits for the longer of the two locks", () => {
    const { tracker, advance } = setup({ maxPerEmail: 1, maxPerIp: 2 });
    tracker.fail("x@b.co", "1.1.1.1"); // the address's first failure, at t0
    advance(40_000);
    tracker.fail("a@b.co", "1.1.1.1"); // locks the email now, and the address too (its oldest failure expires in 20s)
    expect(tracker.status("a@b.co", "1.1.1.1")).toEqual({ blocked: true, retryAfterMs: 60_000 }); // the email lock runs longest
    expect(tracker.status("other@b.co", "1.1.1.1")).toEqual({ blocked: true, retryAfterMs: 20_000 }); // the address alone
  });
});
