// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PendingProposals } from "@/components/Proposals/PendingProposals";
import type { ProposalView } from "@/lib/proposals/view";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/Payments/PayButton", async () => {
  const { createElement } = await import("react");
  return { PayButton: () => createElement("span", null, "PayPal button") };
});

beforeEach(() => refresh.mockClear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const view = (over: Partial<ProposalView> = {}): ProposalView => ({
  id: "p1",
  kind: "message",
  title: "A note for you",
  summary: "The deposit is non-refundable.",
  amount: null,
  details: [],
  draft: null,
  reason: "",
  citation: null,
  clauseHref: null,
  paymentId: null,
  approvable: true,
  createdAt: "2026-11-07T10:00:00.000Z",
  ...over,
});

function stubResolve(body: unknown, status = 200) {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify(body), { status }));
}
const click = async (name: string | RegExp) => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
};

describe("PendingProposals", () => {
  it("shows nothing when nothing is waiting", () => {
    const { container } = render(<PendingProposals proposals={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("lists what is waiting, each as a card", () => {
    render(<PendingProposals proposals={[view({ id: "a", title: "A note for you" }), view({ id: "b", kind: "reschedule", title: "Move the wedding" })]} />);
    expect(screen.getByRole("heading", { name: "Waiting for your approval" })).toBeTruthy();
    expect(screen.getAllByRole("article").map((a) => a.getAttribute("aria-labelledby"))).toEqual(["proposal-a", "proposal-b"]);
    expect(screen.getByRole("article", { name: "Move the wedding" })).toBeTruthy();
  });

  it("says what happened after approving, and refreshes the page so everything updates", async () => {
    stubResolve({ ok: true, status: "approved", message: "Noted." });
    render(<PendingProposals proposals={[view()]} />);
    await click("Got it");

    expect(refresh).toHaveBeenCalledTimes(1);
    expect((await screen.findByRole("status")).textContent).toContain("Noted.");
  });

  it("keeps what happened on screen after the resolved card leaves the list, until dismissed", async () => {
    stubResolve({ ok: true, status: "approved", message: "Approved. The wedding is now on 2027-06-12." });
    const { rerender } = render(<PendingProposals proposals={[view({ kind: "reschedule", title: "Move the wedding" })]} />);
    await click("Approve and move the wedding");

    rerender(<PendingProposals proposals={[]} />); // the refresh removes the resolved card
    expect(screen.getByRole("status").textContent).toContain("Approved. The wedding is now on 2027-06-12.");
    expect(screen.getByRole("heading", { name: "Waiting for your approval" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("heading")).toBeNull(); // nothing waiting and nothing to report: the section goes away
  });

  it("says so when a proposal is dismissed", async () => {
    stubResolve({ ok: true, status: "dismissed", message: "Dismissed. Nothing was changed." });
    render(<PendingProposals proposals={[view()]} />);
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Dismiss" })[0]);
    });
    expect((await screen.findByRole("status")).textContent).toContain("Dismissed. Nothing was changed.");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh or report success when the server refuses", async () => {
    stubResolve({ ok: false, error: { code: "stale", message: "The wedding date has changed since this was proposed." } }, 409);
    render(<PendingProposals proposals={[view({ kind: "reschedule" })]} />);
    await click("Approve and move the wedding");

    expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
    expect((await screen.findByRole("alert")).textContent).toContain("has changed");
  });

  describe("a refund request", () => {
    const refund = () => view({ kind: "refund_request", title: "Request a refund", draft: "Dear vendor, please refund us." });
    const approveRefund = () => stubResolve({ ok: true, status: "approved", message: "Approved. The payment is now marked refund requested.", draft: "Dear vendor, please refund us." });

    it("hands back the drafted message to copy: nothing is sent for the couple", async () => {
      approveRefund();
      render(<PendingProposals proposals={[refund()]} />);
      await click("Approve this request");
      const banner = await screen.findByRole("status");
      expect(banner.textContent).toContain("Dear vendor, please refund us.");
      expect(screen.getByRole("button", { name: "Copy message" })).toBeTruthy();
    });

    it("copies the message to the clipboard and says so", async () => {
      approveRefund();
      const writeText = vi.fn(async () => {});
      vi.stubGlobal("navigator", { clipboard: { writeText } });
      render(<PendingProposals proposals={[refund()]} />);
      await click("Approve this request");
      await click("Copy message");

      expect(writeText).toHaveBeenCalledWith("Dear vendor, please refund us.");
      expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
    });

    it("copes with a clipboard that refuses, leaving the text on screen to select", async () => {
      approveRefund();
      vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
      render(<PendingProposals proposals={[refund()]} />);
      await click("Approve this request");
      await click("Copy message");

      expect(screen.getByRole("button", { name: "Copy message" })).toBeTruthy();
      expect(screen.getByRole("status").textContent).toContain("Dear vendor, please refund us.");
    });
  });
});
