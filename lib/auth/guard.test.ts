import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const session = vi.hoisted(() => ({ current: null as null | { user: { id?: string; isDemo?: boolean } } }));
vi.mock("@/lib/auth", () => ({ auth: async () => session.current }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));

import { requireUser, withSession } from "@/lib/auth/guard";

beforeEach(() => {
  session.current = null;
});

describe("withSession", () => {
  it("answers 401 without running the handler when signed out, or when the session has no user", async () => {
    const handler = vi.fn(async () => new Response("ran"));
    for (const s of [null, { user: {} }]) {
      session.current = s;
      const res = await withSession(handler)(new Request("http://localhost/api/x"));
      expect(res.status).toBe(401);
      expect((await res.json()).error.message).toBe("Your session ended. Sign in again.");
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it("runs the handler with its arguments for a signed-in user", async () => {
    session.current = { user: { id: "u1" } };
    const handler = vi.fn(async (_r: Request, b: number) => new Response(`x${b}`));
    const res = await withSession(handler)(new Request("http://localhost/api/x"), 2);
    expect(await res.text()).toBe("x2");
  });
});

describe("requireUser", () => {
  it("sends a signed-out visitor to /login with the page as next", async () => {
    await expect(requireUser("/upload")).rejects.toThrow("REDIRECT /login?next=%2Fupload");
  });
  it("returns the signed-in user", async () => {
    session.current = { user: { id: "u1", isDemo: true } };
    expect(await requireUser("/")).toEqual({ id: "u1", isDemo: true });
  });
});
