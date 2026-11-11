import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { registerFromForm } from "@/lib/auth/sign-up";
import { createRateLimiter } from "@/lib/rate-limit";
import { createTestDatabase } from "@/lib/test-utils/db";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(() => {
  ({ prisma, cleanup } = createTestDatabase());
}, 60_000);
afterAll(async () => cleanup());
beforeEach(async () => {
  await prisma.user.deleteMany();
});

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const good = { name: "Priya & Sam", email: "Priya@Example.com", password: "a decent passphrase" };
const deps = (max = 100) => ({ prisma, limiter: createRateLimiter({ max, windowMs: 60_000, now: () => 0 }), ip: "1.1.1.1" });

describe("registerFromForm", () => {
  it("creates the account and hands back what the action needs to sign the person in", async () => {
    const result = await registerFromForm(deps(), form({ ...good, next: "/upload" }));
    expect(result).toEqual({ ok: true, email: "priya@example.com", password: "a decent passphrase", redirectTo: "/upload" });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "priya@example.com" } });
    expect(user.name).toBe("Priya & Sam");
    expect(user.passwordHash).toMatch(/^scrypt\$/);
    expect(user.isDemo).toBe(false);
  });

  it("goes to the dashboard unless next is a safe path on this site", async () => {
    for (const next of ["", "https://evil.example", "//evil.example", "/login"]) {
      await prisma.user.deleteMany();
      const result = await registerFromForm(deps(), form({ ...good, next }));
      expect(result.ok && result.redirectTo, next).toBe("/");
    }
  });

  it("accepts a missing name", async () => {
    const result = await registerFromForm(deps(), form({ email: "noname@example.com", password: "a decent passphrase" }));
    expect(result.ok).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: "noname@example.com" } })).name).toBeNull();
  });

  it("reports each problem against its own field, keeps what was typed, and creates nothing", async () => {
    const result = await registerFromForm(deps(), form({ name: "Priya", email: "not an email", password: "short" }));
    expect(result).toEqual({
      ok: false,
      state: {
        errors: { email: "Enter a valid email address.", password: "Use at least 10 characters." },
        values: { name: "Priya", email: "not an email" },
        emailTaken: false,
      },
    });
    expect(await prisma.user.count()).toBe(0);
  });

  it("never puts the password in what it returns on failure", async () => {
    const result = await registerFromForm(deps(), form({ email: "bad", password: "my secret passphrase but bad email" }));
    expect(JSON.stringify(result)).not.toContain("secret passphrase");
  });

  it("flags an email that already has an account, in any case, and says so for the sign-in link", async () => {
    await registerFromForm(deps(), form(good));
    const again = await registerFromForm(deps(), form({ ...good, email: "PRIYA@example.com", password: "another passphrase" }));
    expect(again).toEqual({
      ok: false,
      state: {
        errors: { email: "There's already an account for that email." },
        values: { name: "Priya & Sam", email: "PRIYA@example.com" },
        emailTaken: true,
      },
    });
    expect(await prisma.user.count()).toBe(1);
  });

  it("refuses a missing form field rather than throwing", async () => {
    const result = await registerFromForm(deps(), new FormData());
    expect(result.ok).toBe(false);
    expect(!result.ok && Object.keys(result.state.errors).sort()).toEqual(["email", "password"]);
  });

  it("is rate limited per address, counting every attempt, and says to wait", async () => {
    const limited = deps(2);
    await registerFromForm(limited, form({ email: "bad", password: "x" })); // an invalid attempt still counts
    await registerFromForm(limited, form({ ...good, email: "a@example.com" }));
    const third = await registerFromForm(limited, form({ ...good, email: "b@example.com" }));
    expect(third).toMatchObject({ ok: false, state: { errors: { form: "Too many sign-up attempts. Please wait a minute and try again." } } });
    expect(await prisma.user.count()).toBe(1); // the third was refused before anything was created

    // Another address is unaffected.
    expect((await registerFromForm({ ...limited, ip: "2.2.2.2" }, form({ ...good, email: "c@example.com" }))).ok).toBe(true);
  });
});
