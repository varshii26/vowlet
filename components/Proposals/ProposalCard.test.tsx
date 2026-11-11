// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProposalCard, type Resolved } from "@/components/Proposals/ProposalCard";
import type { ProposalView } from "@/lib/proposals/view";

// The PayPal button has its own tests; here it is a stub that reports a settled payment when clicked.
const stub = vi.hoisted(() => ({ state: "paid" as "paid" | "pending" }));
vi.mock("@/components/Payments/PayButton", async () => {
  const { createElement } = await import("react");
  return {
    PayButton: ({ paymentId, onSettled }: { paymentId: string; onSettled?: (o: unknown) => void }) =>
      createElement("button", { onClick: () => onSettled?.({ ok: true, state: stub.state, message: "Payment complete." }) }, `Pay with PayPal (${paymentId})`),
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  stub.state = "paid";
});

const view = (over: Partial<ProposalView> = {}): ProposalView => ({
  id: "p1",
  kind: "reschedule",
  title: "Move the wedding",
  summary: "From Apr 17, 2027 to Jun 12, 2027. Every payment date moves with it.",
  amount: { label: "$1,330", caption: "in vendor change fees" },
  details: ["Grand Oak Estate: $450", "Bloom & Thistle Florals: $150"],
  draft: null,
  reason: "The couple asked to postpone.",
  citation: null,
  clauseHref: null,
  paymentId: null,
  approvable: true,
  fees: [],
  dateChange: null,
  warning: null,
  createdAt: "2026-11-07T10:00:00.000Z",
  ...over,
});

type Call = { url: string; action: string };
let calls: Call[];
function stubResolve(...replies: Array<{ status?: number; body: unknown } | Error>) {
  calls = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, action: JSON.parse(String(init.body)).action });
    const next = replies.shift();
    if (!next) throw new Error("no more replies");
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  });
}
const approved = (message = "Approved.", extra: object = {}) => ({ body: { ok: true, status: "approved", message, ...extra } });
const refused = (message: string, status = 409) => ({ status, body: { ok: false, error: { code: "x", message } } });

const click = async (name: string | RegExp) => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
};

const makeOnResolved = () => vi.fn<(result: Resolved) => void>();
let onResolved: ReturnType<typeof makeOnResolved>;
beforeEach(() => {
  onResolved = makeOnResolved();
});

describe("what the card shows", () => {
  it("shows what will happen, how much, the supporting lines and why", () => {
    render(<ProposalCard proposal={view()} onResolved={onResolved} />);
    expect(screen.getByRole("article", { name: "Move the wedding" })).toBeTruthy();
    expect(screen.getByText("From Apr 17, 2027 to Jun 12, 2027. Every payment date moves with it.")).toBeTruthy();
    expect(screen.getByText("$1,330")).toBeTruthy();
    expect(screen.getByText("in vendor change fees")).toBeTruthy();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Grand Oak Estate: $450", "Bloom & Thistle Florals: $150"]);
    expect(screen.getByText("Why: The couple asked to postpone.")).toBeTruthy();
  });

  it("lists each vendor's fee with its own clause chip linking to the contract", () => {
    const fees = [
      { vendorId: "a", vendorName: "Grand Oak Estate", amountLabel: "$450", citation: "Grand Oak Estate contract, page 2", clauseHref: "/vendors/a?clause=c1" },
      { vendorId: "b", vendorName: "Bloom & Thistle Florals", amountLabel: "$150", citation: "Bloom & Thistle Florals contract, page 2", clauseHref: "/vendors/b?clause=c2" },
    ];
    render(<ProposalCard proposal={view({ details: [], fees })} onResolved={onResolved} />);
    const list = screen.getByRole("list", { name: "Change fee per vendor" });
    expect(Array.from(list.querySelectorAll("li")).map((li) => li.textContent)).toEqual([
      "Grand Oak Estate$450Grand Oak Estate contract, page 2",
      "Bloom & Thistle Florals$150Bloom & Thistle Florals contract, page 2",
    ]);
    expect(screen.getByRole("link", { name: "Bloom & Thistle Florals contract, page 2" }).getAttribute("href")).toBe("/vendors/b?clause=c2");
  });

  it("shows the wedding date and the next payments before and after the move", () => {
    const dateChange = {
      from: "Apr 17, 2027",
      to: "Jun 12, 2027",
      payments: [{ key: "k", title: "Grand Oak Estate: Venue balance", from: "Mar 18, 2027", to: "May 13, 2027" }],
    };
    render(<ProposalCard proposal={view({ details: [], dateChange })} onResolved={onResolved} />);
    const box = screen.getByTestId("proposal-dates");
    expect(box.textContent).toContain("Apr 17, 2027");
    expect(box.textContent).toContain("Jun 12, 2027");
    expect(box.textContent).toContain("Grand Oak Estate: Venue balance");
    expect(box.textContent).toContain("Mar 18, 2027");
    expect(box.textContent).toContain("May 13, 2027");
  });

  it("turns warning-coloured and states the overage when the move goes over budget", () => {
    const warning = "Over budget by $700: the wedding would cost $36,700 against a $36,000 budget. The biggest change fee is Grand Oak Estate ($2,700).";
    render(<ProposalCard proposal={view({ warning })} onResolved={onResolved} />);
    expect(screen.getByRole("article").getAttribute("data-warning")).toBe("over-budget");
    expect(screen.getByRole("note").textContent).toBe(warning);
  });

  it("has no warning styling within budget", () => {
    render(<ProposalCard proposal={view()} onResolved={onResolved} />);
    expect(screen.getByRole("article").getAttribute("data-warning")).toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("shows the clause it rests on, in words, as a chip", () => {
    render(<ProposalCard proposal={view({ citation: "Grand Oak Estate contract, page 2" })} onResolved={onResolved} />);
    expect(screen.getByText("Grand Oak Estate contract, page 2")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("links the clause chip to the clause in the contract when it can", () => {
    render(<ProposalCard proposal={view({ citation: "Grand Oak Estate contract, page 2", clauseHref: "/vendors/v1?clause=c9" })} onResolved={onResolved} />);
    expect(screen.getByRole("link", { name: "Grand Oak Estate contract, page 2" }).getAttribute("href")).toBe("/vendors/v1?clause=c9");
  });

  it("shows a refund request's drafted message to read before approving", () => {
    render(<ProposalCard proposal={view({ kind: "refund_request", draft: "Dear Bloom & Thistle, please refund us." })} onResolved={onResolved} />);
    fireEvent.click(screen.getByText("Drafted message to the vendor"));
    expect(screen.getByText("Dear Bloom & Thistle, please refund us.")).toBeTruthy();
  });

  it("leaves out what a proposal doesn't have", () => {
    render(<ProposalCard proposal={view({ kind: "message", amount: null, details: [], reason: "", summary: "The deposit is non-refundable." })} onResolved={onResolved} />);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByText(/Why:/)).toBeNull();
    expect(screen.queryByText("Drafted message to the vendor")).toBeNull();
  });

  it("words the approve button for what it does", () => {
    const label = (kind: ProposalView["kind"]) => {
      const { unmount } = render(<ProposalCard proposal={view({ kind })} onResolved={onResolved} />);
      const buttons = screen.getAllByRole("button").map((b) => b.textContent);
      unmount();
      return buttons[0];
    };
    expect(label("reschedule")).toBe("Approve and move the wedding");
    expect(label("refund_request")).toBe("Approve this request");
    expect(label("message")).toBe("Got it");
  });
});

describe("approving", () => {
  it("asks the server, then reports what happened", async () => {
    stubResolve(approved("Approved. The wedding is now on 2027-06-12."));
    render(<ProposalCard proposal={view()} onResolved={onResolved} />);
    await click("Approve and move the wedding");

    expect(calls).toEqual([{ url: "/api/proposals/p1", action: "approve" }]);
    expect(onResolved).toHaveBeenCalledWith({ proposal: view(), status: "approved", message: "Approved. The wedding is now on 2027-06-12.", draft: undefined });
  });

  it("passes on a refund request's drafted message", async () => {
    stubResolve(approved("Approved.", { draft: "Please refund us." }));
    render(<ProposalCard proposal={view({ kind: "refund_request" })} onResolved={onResolved} />);
    await click("Approve this request");
    expect(onResolved.mock.calls[0][0].draft).toBe("Please refund us.");
  });

  it("shows why when the server refuses, and reports nothing resolved", async () => {
    stubResolve(refused("The wedding date has changed since this was proposed."));
    render(<ProposalCard proposal={view()} onResolved={onResolved} />);
    await click("Approve and move the wedding");

    expect((await screen.findByRole("alert")).textContent).toBe("The wedding date has changed since this was proposed.");
    expect(onResolved).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Approve and move the wedding" }) as HTMLButtonElement).disabled).toBe(false); // can retry
  });

  it("says so when the network fails", async () => {
    stubResolve(new TypeError("offline"));
    render(<ProposalCard proposal={view()} onResolved={onResolved} />);
    await click("Approve and move the wedding");
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't reach Vowlet");
  });

  it("disables both buttons while it works, so it can't be clicked twice", async () => {
    let finish: (r: Response) => void = () => {};
    vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => (finish = resolve)));
    render(<ProposalCard proposal={view()} onResolved={onResolved} />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Approve and move the wedding" }));
    });

    expect((screen.getByRole("button", { name: "Working…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Dismiss" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish(new Response(JSON.stringify({ ok: true, status: "approved", message: "Approved." }))));
    expect(onResolved).toHaveBeenCalledTimes(1);
  });

  it("clears an earlier problem when tried again", async () => {
    stubResolve(refused("Try later."), approved());
    render(<ProposalCard proposal={view()} onResolved={onResolved} />);
    await click("Approve and move the wedding");
    await screen.findByRole("alert");
    await click("Approve and move the wedding");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("dismissing", () => {
  it("asks the server to dismiss and reports it", async () => {
    stubResolve({ body: { ok: true, status: "dismissed", message: "Dismissed. Nothing was changed." } });
    render(<ProposalCard proposal={view()} onResolved={onResolved} />);
    await click("Dismiss");
    expect(calls).toEqual([{ url: "/api/proposals/p1", action: "dismiss" }]);
    expect(onResolved).toHaveBeenCalledWith(expect.objectContaining({ status: "dismissed", message: "Dismissed. Nothing was changed." }));
  });

  it("shows a problem if dismissing fails", async () => {
    stubResolve(refused("This proposal was already approved."));
    render(<ProposalCard proposal={view()} onResolved={onResolved} />);
    await click("Dismiss");
    expect((await screen.findByRole("alert")).textContent).toContain("already approved");
  });
});

describe("a payment", () => {
  const pay = () => view({ id: "p9", kind: "pay", title: "Pay Grand Oak Estate", paymentId: "pay-1", amount: { label: "$3,000", caption: "to pay now" }, details: [] });

  it("is approved with PayPal, not with an Approve button", () => {
    render(<ProposalCard proposal={pay()} onResolved={onResolved} />);
    expect(screen.getByRole("button", { name: "Pay with PayPal (pay-1)" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Approve/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
  });

  it("is only recorded as approved after the payment goes through, and then the server checks it really was paid", async () => {
    stubResolve(approved("Approved. $3,000 was paid to Grand Oak Estate (Venue second installment)."));
    render(<ProposalCard proposal={pay()} onResolved={onResolved} />);
    expect(calls ?? []).toHaveLength(0); // nothing is sent just by showing the card

    await click("Pay with PayPal (pay-1)");
    expect(calls).toEqual([{ url: "/api/proposals/p9", action: "approve" }]);
    expect(onResolved).toHaveBeenCalledWith(expect.objectContaining({ status: "approved", message: expect.stringContaining("$3,000 was paid") }));
  });

  it("tells the couple, and offers to check again, when the payment is still processing", async () => {
    stub.state = "pending";
    stubResolve(refused("This payment hasn't been made yet. Pay with PayPal, and the proposal is approved once it goes through."), approved("Approved."));
    render(<ProposalCard proposal={pay()} onResolved={onResolved} />);
    await click("Pay with PayPal (pay-1)");

    expect((await screen.findByRole("alert")).textContent).toContain("hasn't been made yet");
    expect(onResolved).not.toHaveBeenCalled();

    await click("Check again");
    expect(calls).toHaveLength(2);
    expect(onResolved).toHaveBeenCalledTimes(1);
  });

  it("can be dismissed without paying", async () => {
    stubResolve({ body: { ok: true, status: "dismissed", message: "Dismissed. Nothing was changed." } });
    render(<ProposalCard proposal={pay()} onResolved={onResolved} />);
    await click("Dismiss");
    expect(onResolved).toHaveBeenCalledWith(expect.objectContaining({ status: "dismissed" }));
  });
});

describe("a proposal whose details can't be read", () => {
  it("can only be dismissed", () => {
    render(<ProposalCard proposal={view({ title: "Unreadable proposal", summary: "The details couldn't be read.", amount: null, details: [], approvable: false })} onResolved={onResolved} />);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Dismiss"]);
  });
});
