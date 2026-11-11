import { afterEach, describe, expect, it, vi } from "vitest";

describe("the shared sign-in limiters", () => {
  afterEach(() => {
    vi.resetModules();
    delete (globalThis as { __vowletAuthLimits?: unknown }).__vowletAuthLimits;
  });

  it("are one set per process, even when the module is loaded twice (as separate Next bundles do)", async () => {
    const first = await import("@/lib/auth/limits");
    vi.resetModules(); // a second bundle gets its own copy of the module...
    const second = await import("@/lib/auth/limits");
    expect(second).not.toBe(first);
    // ...but not its own limiters: a lockout recorded through one is seen through the other.
    for (let i = 0; i < 5; i++) first.signInAttempts.fail("victim@example.com", "1.1.1.1");
    expect(second.signInAttempts.status("victim@example.com", "9.9.9.9").blocked).toBe(true);
    expect(second.demoSignIns).toBe(first.demoSignIns);
  });
});
