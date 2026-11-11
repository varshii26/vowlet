// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionWatcher } from "@/components/Auth/SessionWatcher";

vi.mock("next/navigation", () => ({ usePathname: () => "/vendors/abc" }));

const realFetch = window.fetch;
let reply: { status: number; url: string };
beforeEach(() => {
  reply = { status: 200, url: "http://localhost:3000/api/agent" };
  window.fetch = vi.fn(async () => ({ status: reply.status, url: reply.url }) as Response);
});
afterEach(() => {
  cleanup();
  window.fetch = realFetch;
});

async function call() {
  render(<SessionWatcher />);
  await act(async () => {
    await window.fetch("/api/agent");
  });
}

describe("SessionWatcher", () => {
  it("shows nothing while the session is fine", async () => {
    await call();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("tells the person their session ended and links back to sign in, keeping their place", async () => {
    reply.status = 401;
    await call();
    expect(screen.getByRole("alert").textContent).toContain("Your session ended");
    expect(screen.getByRole("link", { name: "Sign in again" }).getAttribute("href")).toBe("/login?next=%2Fvendors%2Fabc");
  });

  it("ignores a 401 from the sign-in endpoints (a wrong password is not a lost session)", async () => {
    reply = { status: 401, url: "http://localhost:3000/api/auth/callback/credentials" };
    await call();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ignores a 401 from another site", async () => {
    reply = { status: 401, url: "https://api.example.com/api/thing" };
    await call();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("puts the original fetch back when it goes away", () => {
    const before = window.fetch;
    const { unmount } = render(<SessionWatcher />);
    unmount();
    expect(window.fetch).toBe(before);
  });
});
