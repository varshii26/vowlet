import type { Account, Profile, Session, User } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { describe, expect, it } from "vitest";
import { jwt, session, signIn } from "@/lib/auth/callbacks";

const google = { provider: "google", type: "oidc", providerAccountId: "g-1" } as Account;
const credentials = { provider: "credentials", type: "credentials", providerAccountId: "u1" } as Account;

describe("signIn callback", () => {
  it("lets Google in only when Google says it verified the email", () => {
    expect(signIn({ account: google, profile: { email: "a@b.co", email_verified: true } as Profile })).toBe(true);
    expect(signIn({ account: google, profile: { email: "a@b.co", email_verified: false } as Profile })).toBe(false);
    expect(signIn({ account: google, profile: { email: "a@b.co" } as Profile })).toBe(false);
    expect(signIn({ account: google })).toBe(false);
  });

  it("does not interfere with email + password sign-in", () => {
    expect(signIn({ account: credentials })).toBe(true);
  });
});

describe("jwt callback", () => {
  it("remembers who signed in, and whether it is the demo user", () => {
    expect(jwt({ token: {} as JWT, user: { id: "u1", isDemo: false } as User })).toMatchObject({ sub: "u1", isDemo: false });
    expect(jwt({ token: {} as JWT, user: { id: "demo-user", isDemo: true } as User })).toMatchObject({ sub: "demo-user", isDemo: true });
    expect(jwt({ token: {} as JWT, user: { id: "u2" } as User }).isDemo).toBe(false); // absent means not the demo
  });

  it("keeps the token as it is on later requests, when there is no user", () => {
    const token = { sub: "u1", isDemo: true } as JWT;
    expect(jwt({ token })).toEqual({ sub: "u1", isDemo: true });
  });
});

describe("session callback", () => {
  it("puts the user's id and demo flag on the session", () => {
    const out = session({ session: { user: { name: "Sam" }, expires: "x" } as unknown as Session, token: { sub: "u1", isDemo: true } as JWT });
    expect(out.user).toMatchObject({ id: "u1", isDemo: true, name: "Sam" });
  });

  it("never marks a session as the demo unless the token says so", () => {
    const out = session({ session: { user: {}, expires: "x" } as unknown as Session, token: { sub: "u1" } as JWT });
    expect(out.user.isDemo).toBe(false);
  });
});
