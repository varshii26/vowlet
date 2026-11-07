import { afterEach, describe, expect, it, vi } from "vitest";
import { requestResolve } from "@/lib/proposals/client";

afterEach(() => vi.unstubAllGlobals());

const respond = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("requestResolve", () => {
  it("posts the action to the proposal's route", async () => {
    const fetchMock = respond({ ok: true, status: "approved", message: "Noted." });
    vi.stubGlobal("fetch", fetchMock);

    expect(await requestResolve("prop 1", "approve")).toEqual({ ok: true, status: "approved", message: "Noted." });
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/proposals/prop%201");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ action: "approve" });
  });

  it("returns the drafted message for an approved refund request", async () => {
    vi.stubGlobal("fetch", respond({ ok: true, status: "approved", message: "Approved.", draft: "Dear vendor, please refund." }));
    expect(await requestResolve("p", "approve")).toEqual({ ok: true, status: "approved", message: "Approved.", draft: "Dear vendor, please refund." });
  });

  it("handles dismissing", async () => {
    vi.stubGlobal("fetch", respond({ ok: true, status: "dismissed", message: "Dismissed. Nothing was changed." }));
    expect(await requestResolve("p", "dismiss")).toMatchObject({ ok: true, status: "dismissed" });
  });

  it("shows the server's reason when it refuses", async () => {
    vi.stubGlobal("fetch", respond({ ok: false, error: { code: "not_paid", message: "This payment hasn't been made yet." } }, 409));
    expect(await requestResolve("p", "approve")).toEqual({ ok: false, message: "This payment hasn't been made yet." });
  });

  it("says so when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    expect(await requestResolve("p", "approve")).toEqual({ ok: false, message: "Couldn't reach Vowlet. Check your connection and try again." });
  });

  it("gives a plain message for a response it can't read, and says nothing changed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>oops</html>", { status: 500 })));
    const r = await requestResolve("p", "approve");
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.message).toContain("Nothing was changed");
  });

  it("refuses to treat an unknown status as a success", async () => {
    vi.stubGlobal("fetch", respond({ ok: true, status: "teleported", message: "hi" }));
    expect((await requestResolve("p", "approve")).ok).toBe(false);
  });
});
