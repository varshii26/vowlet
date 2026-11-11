import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { vowletAdapter } from "@/lib/auth/adapter";
import { credentialsSchema, normalizeEmail, registerSchema, registerUser, verifyCredentials } from "@/lib/auth/users";
import { createTestDatabase } from "@/lib/test-utils/db";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(() => {
  ({ prisma, cleanup } = createTestDatabase());
}, 60_000);
afterAll(async () => cleanup());
beforeEach(async () => {
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
});

const register = (over: Partial<Parameters<typeof registerUser>[1]> = {}) =>
  registerUser(prisma, { name: "Priya & Sam", email: "Priya@Example.com", password: "a decent passphrase", ...over });

describe("registerSchema", () => {
  it("trims and lower-cases the email, and trims the name", () => {
    expect(registerSchema.parse({ name: "  Priya & Sam ", email: "  Priya@Example.COM ", password: "a decent passphrase" })).toEqual({
      name: "Priya & Sam",
      email: "priya@example.com",
      password: "a decent passphrase",
    });
  });

  it("reports each problem against its own field", () => {
    const result = registerSchema.safeParse({ email: "not an email", password: "short" });
    expect(result.success).toBe(false);
    const byField = Object.fromEntries((result.error?.issues ?? []).map((i) => [String(i.path[0]), i.message]));
    expect(byField).toMatchObject({ email: "Enter a valid email address.", password: "Use at least 10 characters." });
  });

  it("refuses a password of spaces and an absurdly long one", () => {
    expect(registerSchema.safeParse({ email: "a@b.co", password: " ".repeat(12) }).success).toBe(false);
    expect(registerSchema.safeParse({ email: "a@b.co", password: "x".repeat(201) }).success).toBe(false);
  });
});

describe("registerUser", () => {
  it("creates a user with a hashed password and returns nothing secret", async () => {
    const result = await register();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user).toEqual({ id: expect.any(String), name: "Priya & Sam", email: "priya@example.com", image: null, isDemo: false });
    expect(JSON.stringify(result)).not.toMatch(/passphrase|passwordHash|scrypt/);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: result.user.id } });
    expect(row.passwordHash).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(row.passwordHash).not.toContain("decent passphrase");
    expect(row.isDemo).toBe(false);
  });

  it("refuses an email that already has an account, whatever its case", async () => {
    expect((await register()).ok).toBe(true);
    expect(await register({ email: "priya@example.com", password: "another passphrase" })).toEqual({ ok: false, code: "email_taken" });
    expect(await register({ email: "PRIYA@EXAMPLE.COM" })).toEqual({ ok: false, code: "email_taken" });
    expect(await prisma.user.count()).toBe(1);
  });

  it("never takes over or links to a Google account that has the same email", async () => {
    const google = await prisma.user.create({ data: { email: "sam@example.com", emailVerified: new Date() } });
    await prisma.account.create({ data: { userId: google.id, type: "oidc", provider: "google", providerAccountId: "g-1" } });
    expect(await register({ email: "sam@example.com" })).toEqual({ ok: false, code: "email_taken" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: google.id } })).passwordHash).toBeNull();
  });

  it("lets two sign-ups for one address race: exactly one wins", async () => {
    const results = await Promise.all([register({ email: "race@example.com" }), register({ email: "race@example.com" })]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.code === "email_taken")).toHaveLength(1);
    expect(await prisma.user.count()).toBe(1);
  });

  it("allows a missing name", async () => {
    const result = await register({ name: undefined, email: "noname@example.com" });
    expect(result.ok && result.user.name).toBeNull();
  });
});

describe("verifyCredentials", () => {
  it("returns the user for the right email (any case) and password", async () => {
    await register();
    for (const email of ["priya@example.com", "  PRIYA@example.com "]) {
      const user = await verifyCredentials(prisma, email, "a decent passphrase");
      expect(user).toMatchObject({ email: "priya@example.com", name: "Priya & Sam", isDemo: false });
      expect(user).not.toHaveProperty("passwordHash");
    }
  });

  it("returns null for a wrong password, an unknown email, and an empty password", async () => {
    await register();
    expect(await verifyCredentials(prisma, "priya@example.com", "wrong passphrase")).toBeNull();
    expect(await verifyCredentials(prisma, "nobody@example.com", "a decent passphrase")).toBeNull();
    expect(await verifyCredentials(prisma, "priya@example.com", "")).toBeNull();
  });

  it("returns null for an account with no password: Google-only users and the demo user", async () => {
    await prisma.user.create({ data: { email: "google@example.com" } });
    await prisma.user.create({ data: { email: "demo@vowlet.invalid", isDemo: true } });
    expect(await verifyCredentials(prisma, "google@example.com", "anything at all")).toBeNull();
    expect(await verifyCredentials(prisma, "demo@vowlet.invalid", "anything at all")).toBeNull();
  });

  it("takes about as long for an unknown email as for a wrong password, so the two cannot be told apart", async () => {
    await register();
    const time = async (email: string) => {
      const start = performance.now();
      await verifyCredentials(prisma, email, "wrong passphrase");
      return performance.now() - start;
    };
    await time("warm@up.example"); // builds the decoy hash once
    const wrongPassword = await time("priya@example.com");
    const unknownEmail = await time("nobody@example.com");
    // Both pay for a full scrypt run (tens of ms); without the decoy the unknown email returns in about 1ms.
    expect(unknownEmail).toBeGreaterThan(wrongPassword / 3);
  });
});

describe("credentialsSchema", () => {
  it("only checks the shape: sign-in must not enforce the sign-up password rules", () => {
    expect(credentialsSchema.parse({ email: "A@B.co", password: "x" })).toEqual({ email: "a@b.co", password: "x" });
    expect(credentialsSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
    expect(credentialsSchema.safeParse({ email: "nope", password: "x" }).success).toBe(false);
  });
});

describe("the Auth.js adapter", () => {
  it("lower-cases emails going in and coming out, so one address is one user", async () => {
    const adapter = vowletAdapter(prisma);
    const created = await adapter.createUser!({ id: "ignored", email: "Mixed.Case@Example.com", emailVerified: new Date(), name: "Sam", image: null });
    expect(created.email).toBe("mixed.case@example.com");
    expect((await adapter.getUserByEmail!("MIXED.CASE@EXAMPLE.COM"))?.id).toBe(created.id);
    expect(normalizeEmail(" X@Y.Z ")).toBe("x@y.z");
  });

  it("links a Google account to its user and finds it again by the provider's id", async () => {
    const adapter = vowletAdapter(prisma);
    const user = await adapter.createUser!({ id: "ignored", email: "g@example.com", emailVerified: new Date(), name: null, image: null });
    await adapter.linkAccount!({ userId: user.id, type: "oidc", provider: "google", providerAccountId: "g-42" });
    expect((await adapter.getUserByAccount!({ provider: "google", providerAccountId: "g-42" }))?.id).toBe(user.id);
    expect(await adapter.getUserByAccount!({ provider: "google", providerAccountId: "someone-else" })).toBeNull();
  });
});
