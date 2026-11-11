// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClauseViewer } from "@/components/Clauses/ClauseViewer";
import { VendorContractView } from "@/components/Clauses/VendorContractView";
import type { VendorPageData, ViewerClause } from "@/lib/vendors/page-data";

const scrollIntoView = vi.fn();
beforeEach(() => {
  scrollIntoView.mockReset();
  Element.prototype.scrollIntoView = scrollIntoView;
  window.history.replaceState(null, "", "/vendors/v1");
});
afterEach(cleanup);

const PAGES = [
  "Venue Rental Agreement\n2.1 The Client shall pay $3,000 (Venue deposit) upon signing this agreement.\n2.2 The Client shall pay $3,000 (Venue final balance) no later than 30 days before the Event\nDate.\nPage 1 of 2",
  "3. Cancellation\nCancellation by the Client: with at least 90 days' written notice, 50% of payments made will be refunded.\nPage 2 of 2",
];

const CLAUSES: ViewerClause[] = [
  { id: "c-dep", kind: "payment", text: "The Client shall pay $3,000 (Venue deposit) upon signing this agreement.", page: 1, summary: "$3,000 venue deposit, due upon signing" },
  { id: "c-fin", kind: "payment", text: "The Client shall pay $3,000 (Venue final balance) no later than 30 days before the Event Date.", page: 1, summary: "$3,000 final balance" },
  { id: "c-can", kind: "cancellation", text: "Cancellation by the Client: with at least 90 days' written notice, 50% of payments made will be refunded.", page: 2, summary: "50% refund with 90 days' notice" },
  { id: "c-gone", kind: "other", text: "A clause the extraction quoted but the PDF does not contain.", page: 2, summary: "Missing clause" },
];

const DATA: VendorPageData = {
  vendor: { id: "v1", name: "Grand Oak Estate", category: "venue", status: "active", totalLabel: "$6,000", pdfUrl: "/api/vendors/v1/contract" },
  weddingDateLabel: "Apr 17, 2027",
  pages: PAGES,
  clauses: CLAUSES,
  payments: [
    { id: "p1", label: "Venue deposit", amountLabel: "$3,000", dueDateLabel: "Jun 12, 2026", status: "paid", statusLabel: "Paid", clauseId: "c-dep" },
    { id: "p2", label: "Venue final balance", amountLabel: "$3,000", dueDateLabel: "Mar 18, 2027", status: "scheduled", statusLabel: "Scheduled", clauseId: "c-fin" },
  ],
  cancellation: { clauseId: "c-can", tiers: ["90+ days' notice: 50% of payments made refunded"] },
  dateChange: { clauseId: null, tiers: [] },
};

const mark = (id: string) => document.getElementById(`clause-${id}`);

describe("ClauseViewer", () => {
  it("highlights each clause in the page text", () => {
    render(<ClauseViewer pages={PAGES} clauses={CLAUSES} selectedClauseId={null} />);
    expect(screen.getAllByRole("region", { name: /^Page \d$/ })).toHaveLength(2);
    expect(mark("c-dep")?.tagName).toBe("MARK");
    expect(mark("c-dep")?.textContent).toBe(CLAUSES[0].text);
    // Found across the PDF's line break, and shown as the PDF has it.
    expect(mark("c-fin")?.textContent).toBe("The Client shall pay $3,000 (Venue final balance) no later than 30 days before the Event\nDate.");
    expect(screen.getByRole("region", { name: "Page 2" }).contains(mark("c-can"))).toBe(true);
  });

  it("still shows a clause it can't find, quoted with its page", () => {
    render(<ClauseViewer pages={PAGES} clauses={CLAUSES} selectedClauseId={null} />);
    const box = mark("c-gone");
    expect(box?.tagName).toBe("BLOCKQUOTE");
    expect(box?.textContent).toContain(CLAUSES[3].text);
    expect(box?.textContent).toContain("Page 2");
  });

  it("quotes every clause when the PDF couldn't be read", () => {
    render(<ClauseViewer pages={null} clauses={CLAUSES} selectedClauseId={null} />);
    expect(screen.getByRole("alert").textContent).toMatch(/couldn.t be read/);
    for (const c of CLAUSES) expect(mark(c.id)?.tagName).toBe("BLOCKQUOTE");
  });

  it("renders contract text as text, never as HTML", () => {
    const evil = 'Pay now <img src=x onerror="alert(1)"> <script>alert(2)</script> please.';
    const clause: ViewerClause = { id: "evil", kind: "other", text: "<b>Bold</b> refund of 100% of fees paid", page: 1, summary: "<i>x</i>" };
    const { container } = render(<ClauseViewer pages={[`${evil}\n<b>Bold</b> refund of 100% of fees paid`]} clauses={[clause]} selectedClauseId="evil" />);
    expect(container.querySelector("img, script, b, i")).toBeNull();
    expect(container.textContent).toContain(evil);
    expect(mark("evil")?.textContent).toBe("<b>Bold</b> refund of 100% of fees paid");
  });

  it("scrolls to and marks the selected clause", () => {
    render(<ClauseViewer pages={PAGES} clauses={CLAUSES} selectedClauseId="c-can" />);
    expect(mark("c-can")?.dataset.selected).toBe("true");
    expect(mark("c-dep")?.dataset.selected).toBeUndefined();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(mark("c-can"));
    expect(screen.getByText("50% refund with 90 days' notice")).toBeTruthy();
  });

  it("keeps the scrolled-to clause clear of the sticky banner", () => {
    const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(70);
    render(<ClauseViewer pages={PAGES} clauses={CLAUSES} selectedClauseId="c-can" />);
    height.mockRestore();
    // banner height + its top offset + a small gap
    expect(mark("c-can")?.style.scrollMarginTop).toBe("90px");
  });
});

describe("VendorContractView", () => {
  it("opens at the deep-linked clause", () => {
    render(<VendorContractView data={DATA} initialClauseId="c-fin" />);
    expect(mark("c-fin")?.dataset.selected).toBe("true");
    expect(scrollIntoView.mock.contexts[0]).toBe(mark("c-fin"));
  });

  it("shows a notice for an unknown deep-linked clause and still renders the contract", () => {
    render(<VendorContractView data={DATA} initialClauseId="nope" />);
    expect(screen.getByRole("status").textContent).toMatch(/isn.t in this contract/);
    expect(mark("c-dep")).not.toBeNull();
    expect(document.querySelector("[data-selected]")).toBeNull();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("clicking a term jumps to its clause and puts it in the URL", () => {
    render(<VendorContractView data={DATA} initialClauseId={null} />);
    expect(scrollIntoView).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Show the clause for cancellation terms, page 2" }));
    expect(mark("c-can")?.dataset.selected).toBe("true");
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(mark("c-can"));
    expect(window.location.search).toBe("?clause=c-can");

    fireEvent.click(screen.getByRole("button", { name: "Show the clause for Venue deposit, page 1" }));
    expect(mark("c-dep")?.dataset.selected).toBe("true");
    expect(mark("c-can")?.dataset.selected).toBeUndefined();

    // Clicking the same term again scrolls to it again.
    const before = scrollIntoView.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Show the clause for Venue deposit, page 1" }));
    expect(scrollIntoView.mock.calls.length).toBe(before + 1);
  });

  it("links every term to a clause, and says so when one has none", () => {
    render(<VendorContractView data={DATA} initialClauseId={null} />);
    expect(screen.getByRole("button", { name: /Venue final balance, page 1/ })).toBeTruthy();
    expect(screen.getByText("No clause linked")).toBeTruthy(); // the date-change terms above
  });

  it("clicking a highlight selects it", () => {
    render(<VendorContractView data={DATA} initialClauseId={null} />);
    fireEvent.click(mark("c-dep") as HTMLElement);
    expect(mark("c-dep")?.dataset.selected).toBe("true");
    expect(screen.getByRole("button", { name: /Venue deposit, page 1/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("switches to the original PDF at the selected clause's page, and back on a term click", () => {
    render(<VendorContractView data={DATA} initialClauseId="c-can" />);
    fireEvent.click(screen.getByRole("tab", { name: "Original PDF" }));
    expect(screen.getByTitle("Grand Oak Estate contract (PDF)").getAttribute("src")).toBe("/api/vendors/v1/contract#page=2");
    fireEvent.click(screen.getByRole("button", { name: /Venue deposit, page 1/ }));
    expect(screen.queryByTitle("Grand Oak Estate contract (PDF)")).toBeNull();
    expect(mark("c-dep")?.dataset.selected).toBe("true");
  });
});
