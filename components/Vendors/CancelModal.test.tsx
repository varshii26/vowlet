// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CancelModal } from "@/components/Vendors/CancelModal";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

beforeEach(() => refresh.mockClear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const preview = {
  ok: true,
  vendorId: "v1",
  vendorName: "Bloom & Thistle Florals",
  cancelledBy: "vendor",
  cancellationDate: "2026-11-07",
  owedCents: 80_000,
  paidCents: 80_000,
  retainedCents: 0,
  noticeDays: 161,
  reason: "Vendor cancelled, so all $800 paid is owed back.",
  clauseId: "c1",
  citation: "Bloom & Thistle Florals contract, page 2",
  clause: { text: "If the Florist cancels, all payments are refunded.", page: 2 },
  draft: "Dear Bloom & Thistle Florals,\n\nPlease refund $800.",
};

function stub(...bodies: unknown[]) {
  const fetchMock = vi.fn();
  for (const body of bodies) fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body)));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const click = async (name: string | RegExp) => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
};

describe("CancelModal", () => {
  it("shows the computed amount, the clause chip and the draft before anything changes", async () => {
    const fetchMock = stub(preview);
    render(<CancelModal vendorId="v1" vendorName="Bloom & Thistle Florals" />);
    await click(/Cancel vendor/);

    expect(fetchMock).toHaveBeenCalledWith("/api/vendors/v1/cancel", expect.objectContaining({ body: JSON.stringify({ cancelledBy: "vendor" }) }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getAllByText("$800").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Bloom & Thistle Florals contract, page 2" })).toBeTruthy();
    expect(screen.getByText(/Please refund \$800/)).toBeTruthy();
    expect(screen.getByText(/Nothing is sent and no money moves/)).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("re-previews when the couple says they are the ones cancelling", async () => {
    const fetchMock = stub(preview, { ...preview, cancelledBy: "couple", owedCents: 0, retainedCents: 80_000, draft: null, reason: "161 days' notice: 0% refunded." });
    render(<CancelModal vendorId="v1" vendorName="Bloom & Thistle Florals" />);
    await click(/Cancel vendor/);
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "We are cancelling" }));
    });

    expect(fetchMock).toHaveBeenLastCalledWith("/api/vendors/v1/cancel", expect.objectContaining({ body: JSON.stringify({ cancelledBy: "couple" }) }));
    expect(screen.getByText(/Nothing is owed back, so there is no refund to request/)).toBeTruthy();
  });

  it("confirms, refreshes the page and leaves the draft to copy", async () => {
    const fetchMock = stub(preview, { ok: true, message: "Bloom & Thistle Florals is marked cancelled. Nothing has been sent.", draft: preview.draft, owedCents: 80_000 });
    render(<CancelModal vendorId="v1" vendorName="Bloom & Thistle Florals" />);
    await click(/Cancel vendor/);
    await click("Confirm cancellation");

    expect(fetchMock).toHaveBeenLastCalledWith("/api/vendors/v1/cancel", expect.objectContaining({ body: JSON.stringify({ cancelledBy: "vendor", confirm: true }) }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.getByRole("status").textContent).toContain("is marked cancelled");
    expect(screen.getByRole("button", { name: "Copy message" })).toBeTruthy();
  });

  it("shows the server's refusal and doesn't refresh", async () => {
    stub(preview, { ok: false, error: { code: "already_cancelled", message: "Bloom & Thistle Florals is already cancelled." } });
    render(<CancelModal vendorId="v1" vendorName="Bloom & Thistle Florals" />);
    await click(/Cancel vendor/);
    await click("Confirm cancellation");

    expect(screen.getByRole("alert").textContent).toBe("Bloom & Thistle Florals is already cancelled.");
    expect(refresh).not.toHaveBeenCalled();
  });
});
