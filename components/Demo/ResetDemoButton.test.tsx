// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResetDemoButton } from "@/components/Demo/ResetDemoButton";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

beforeEach(() => refresh.mockClear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubReset(body: unknown, status = 200) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const click = async (name: string | RegExp) => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
};

describe("ResetDemoButton", () => {
  it("asks for confirmation before resetting, and does nothing on cancel", async () => {
    const fetchMock = stubReset({ ok: true, message: "done" });
    render(<ResetDemoButton />);

    await click("Reset demo");
    expect(screen.getByText(/Reset Priya & Sam's demo to its starting state\?/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    await click("Cancel");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reset demo" })).toBeTruthy();
  });

  it("resets on confirm, refreshes the page and says so", async () => {
    const fetchMock = stubReset({ ok: true, message: "The demo is back to its starting state." });
    render(<ResetDemoButton />);

    await click("Reset demo");
    await click("Yes, reset");

    expect(fetchMock).toHaveBeenCalledWith("/api/demo/reset", { method: "POST" });
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.getByRole("status").textContent).toBe("The demo is back to its starting state.");
  });

  it("shows the server's message when the reset is refused, and doesn't refresh", async () => {
    stubReset({ ok: false, error: { code: "too_many_requests", message: "The demo was reset a moment ago. Try again in 40 seconds." } }, 429);
    render(<ResetDemoButton />);

    await click("Reset demo");
    await click("Yes, reset");

    expect(screen.getByRole("alert").textContent).toBe("The demo was reset a moment ago. Try again in 40 seconds.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("explains a network failure in plain words", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    render(<ResetDemoButton />);

    await click("Reset demo");
    await click("Yes, reset");

    expect(screen.getByRole("alert").textContent).toBe("Couldn't reach Vowlet. Check your connection and try again.");
    expect(refresh).not.toHaveBeenCalled();
  });
});
