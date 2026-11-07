import { describe, expect, it } from "vitest";
import { layoutContract, locateAll, locateQuote } from "@/lib/vendors/highlight";

const PAGE =
  "2. Fees and Payment\nTotal contract price: $9,000.\n2.1 The Client shall pay $3,000 (Venue deposit) upon signing this agreement.\n2.2 The Client shall pay $3,000 (Venue second installment) no later than 120 days before the Event\nDate.\nPage 1 of 3";

const slice = (text: string, r: { start: number; end: number } | null) => (r ? text.slice(r.start, r.end) : null);

describe("locateQuote", () => {
  it("finds an exact quote and returns the original range", () => {
    const quote = "The Client shall pay $3,000 (Venue deposit) upon signing this agreement.";
    expect(slice(PAGE, locateQuote(PAGE, quote))).toBe(quote);
  });

  it("matches across a line break and differing whitespace, keeping the original text", () => {
    const quote = "The Client shall pay $3,000 (Venue second installment)   no later than 120 days before the Event Date.";
    expect(slice(PAGE, locateQuote(PAGE, quote))).toBe(
      "The Client shall pay $3,000 (Venue second installment) no later than 120 days before the Event\nDate.",
    );
  });

  it("forgives case, curly quotes and dash styles", () => {
    const page = "Cancellation: with at least 90 days' written notice - 50% is refunded.";
    const r = locateQuote(page, "WITH AT LEAST 90 DAYS’ WRITTEN NOTICE – 50% is refunded.");
    expect(slice(page, r)).toBe("with at least 90 days' written notice - 50% is refunded.");
  });

  it("forgives a word hyphenated across a line end", () => {
    const page = "The deposit is non-refund-\nable once paid.";
    expect(slice(page, locateQuote(page, "The deposit is non-refundable once paid."))).toBe(page);
  });

  it("spans an ellipsis from the first piece to the last", () => {
    const r = locateQuote(PAGE, "The Client shall pay $3,000 (Venue deposit) ... this agreement.");
    expect(slice(PAGE, r)).toBe("The Client shall pay $3,000 (Venue deposit) upon signing this agreement.");
  });

  it("returns null when the text is not there or the quote is empty", () => {
    expect(locateQuote(PAGE, "The Client shall pay $4,000 (Venue deposit)")).toBeNull();
    expect(locateQuote(PAGE, "   ")).toBeNull();
  });

  it("lists every occurrence", () => {
    expect(locateAll("pay $5 now. pay $5 now.", "pay $5 now.")).toEqual([
      { start: 0, end: 11 },
      { start: 12, end: 23 },
    ]);
  });
});

describe("layoutContract", () => {
  const pages = ["Intro.\nThe Client shall pay $500 now.\nPage 1", "Cancellation: no refund.\nPage 2"];

  it("splits pages into plain and highlighted runs that rebuild the original text", () => {
    const layout = layoutContract(pages, [
      { id: "c1", text: "The Client shall pay $500 now.", page: 1 },
      { id: "c2", text: "Cancellation: no refund.", page: 2 },
    ]);
    expect(layout.pages.map((segs) => segs.map((s) => s.text).join(""))).toEqual(pages);
    expect(layout.pages[0]).toEqual([
      { text: "Intro.\n", clauseId: null },
      { text: "The Client shall pay $500 now.", clauseId: "c1" },
      { text: "\nPage 1", clauseId: null },
    ]);
    expect(layout.foundOn).toEqual({ c1: 1, c2: 2 });
    expect(layout.unlocated).toEqual([]);
  });

  it("finds a clause on another page when its claimed page is wrong", () => {
    const layout = layoutContract(pages, [{ id: "c2", text: "Cancellation: no refund.", page: 1 }]);
    expect(layout.foundOn).toEqual({ c2: 2 });
  });

  it("reports a clause it cannot find instead of dropping it", () => {
    const missing = { id: "x", text: "A clause that is nowhere in this contract.", page: 1 };
    const layout = layoutContract(pages, [missing]);
    expect(layout.unlocated).toEqual([missing]);
    expect(layout.pages[0]).toEqual([{ text: pages[0], clauseId: null }]);
  });

  it("does not let two clauses share the same text", () => {
    const page = ["Pay $5 now. Pay $5 now."];
    const layout = layoutContract(page, [
      { id: "a", text: "Pay $5 now.", page: 1 },
      { id: "b", text: "Pay $5 now.", page: 1 },
      { id: "c", text: "Pay $5 now.", page: 1 },
    ]);
    expect(layout.pages[0].filter((s) => s.clauseId).map((s) => s.clauseId)).toEqual(["a", "b"]);
    expect(layout.unlocated.map((c) => c.id)).toEqual(["c"]);
  });

  it("handles a contract with no readable pages", () => {
    const clause = { id: "c1", text: "Anything at all here.", page: 1 };
    expect(layoutContract([], [clause])).toEqual({ pages: [], foundOn: {}, unlocated: [clause] });
  });
});
