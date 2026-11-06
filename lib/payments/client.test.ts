import { afterEach, describe, expect, it, vi } from "vitest";
import { requestCapture, requestOrder } from "@/lib/payments/client";

afterEach(() => vi.unstubAllGlobals());

const respond = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("requestOrder", () => {
  it("posts to the order route and returns the order id", async () => {
    const fetchMock = respond({ ok: true, orderId: "ORDER-1" });
    vi.stubGlobal("fetch", fetchMock);

    expect(await requestOrder("pay 1")).toEqual({ ok: true, orderId: "ORDER-1" });
    expect(fetchMock).toHaveBeenCalledWith("/api/payments/pay%201/order", expect.objectContaining({ method: "POST" }));
  });

  it("returns the server's message when it refuses", async () => {
    vi.stubGlobal("fetch", respond({ ok: false, error: { code: "not_payable", message: "This payment has already been settled." } }, 409));
    expect(await requestOrder("p")).toEqual({ ok: false, message: "This payment has already been settled." });
  });

  it("says so when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    expect(await requestOrder("p")).toEqual({ ok: false, message: "Couldn't reach Vowlet. Check your connection and try again." });
  });

  it("gives a plain message for a response that is not JSON or has the wrong shape", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>oops</html>", { status: 500 })));
    const html = await requestOrder("p");
    expect(html).toMatchObject({ ok: false });
    expect(html.ok ? "" : html.message).toContain("Nothing was charged");

    vi.stubGlobal("fetch", respond({ ok: true }));
    expect(await requestOrder("p")).toMatchObject({ ok: false });
  });
});

describe("requestCapture", () => {
  it("posts the order id to the capture route", async () => {
    const fetchMock = respond({ ok: true, state: "paid", message: "Payment complete." });
    vi.stubGlobal("fetch", fetchMock);

    expect(await requestCapture("p1", "ORDER-1")).toEqual({ ok: true, state: "paid", message: "Payment complete." });
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/payments/p1/capture");
    expect(JSON.parse(String(init.body))).toEqual({ orderId: "ORDER-1" });
  });

  it("passes through a pending result", async () => {
    vi.stubGlobal("fetch", respond({ ok: true, state: "pending", message: "Still processing." }, 202));
    expect(await requestCapture("p", "o")).toEqual({ ok: true, state: "pending", message: "Still processing." });
  });

  it("returns the server's message on failure", async () => {
    vi.stubGlobal("fetch", respond({ ok: false, error: { code: "declined", message: "PayPal declined that payment method." } }, 402));
    expect(await requestCapture("p", "o")).toEqual({ ok: false, message: "PayPal declined that payment method." });
  });

  it("says so when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    const result = await requestCapture("p", "o");
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.message).toContain("Couldn't reach Vowlet");
  });

  it("rejects an unknown state rather than trusting it", async () => {
    vi.stubGlobal("fetch", respond({ ok: true, state: "teleported", message: "hi" }));
    expect(await requestCapture("p", "o")).toMatchObject({ ok: false });
  });
});
