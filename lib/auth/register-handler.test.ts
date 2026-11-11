import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createRegisterHandler } from "@/lib/auth/register-handler";
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

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/register", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const handler = (max = 100, now = () => 0) => createRegisterHandler({ prisma, limiter: createRateLimiter({ max, windowMs: 60_000, now }) });
const good = { name: "Priya & Sam", email: "priya@example.com", password: "a decent passphrase" };

describe("POST /api/register", () => {
  it("creates the account and returns the public user, never the password or its hash", async () => {
    const response = await handler()(post(good));
    expect(response.status).toBe(201);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ ok: true, user: { id: expect.any(String), name: "Priya & Sam", email: "priya@example.com", image: null, isDemo: false } });
    expect(text).not.toMatch(/passphrase|passwordHash|scrypt/);
    expect(await prisma.user.count()).toBe(1);
  });

  it("answers 409 for an email that already has an account", async () => {
    const register = handler();
    await register(post(good));
    const again = await register(post({ ...good, email: "PRIYA@example.com" }));
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ ok: false, error: { code: "email_taken", message: "There's already an account for that email." } });
  });

  it("answers 400 with a message per field, so the form can show each next to its field", async () => {
    const response = await handler()(post({ email: "nope", password: "short" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: "invalid", message: "Check the highlighted fields.", fields: { email: "Enter a valid email address.", password: "Use at least 10 characters." } },
    });
    expect(await prisma.user.count()).toBe(0);
  });

  it("answers 400 for a body that is not JSON, and for JSON that is not an object", async () => {
    expect((await handler()(post("not json"))).status).toBe(400);
    expect((await handler()(post("[]"))).status).toBe(400);
    expect((await handler()(post("null"))).status).toBe(400);
  });

  it("ignores any field it doesn't know, so a caller can't set isDemo or a password hash", async () => {
    const response = await handler()(post({ ...good, isDemo: true, passwordHash: "x", id: "demo-user", emailVerified: new Date() }));
    expect(response.status).toBe(201);
    const row = await prisma.user.findFirstOrThrow();
    expect(row.isDemo).toBe(false);
    expect(row.id).not.toBe("demo-user");
    expect(row.emailVerified).toBeNull();
    expect(row.passwordHash).toMatch(/^scrypt\$/);
  });

  it("rate limits per caller: one address is stopped, another is not", async () => {
    const register = handler(2);
    const from = (ip: string, email: string) => register(post({ ...good, email }, { "x-forwarded-for": `${ip}, 10.0.0.1` }));
    expect((await from("1.1.1.1", "a@example.com")).status).toBe(201);
    expect((await from("1.1.1.1", "b@example.com")).status).toBe(201);
    const limited = await from("1.1.1.1", "c@example.com");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    expect((await limited.json()).error.code).toBe("too_many_requests");
    expect((await from("2.2.2.2", "d@example.com")).status).toBe(201);
    expect(await prisma.user.count()).toBe(3);
  });
});
