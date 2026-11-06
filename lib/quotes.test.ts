import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractPdfPages } from "@/lib/pdf-text";
import { MIN_QUOTE_LENGTH, verifyQuote } from "@/lib/quotes";
import { buildVendorClauses, vendorStyle } from "@/lib/seed/clauses";
import { VENDORS } from "@/lib/seed/demo-data";

const CLAUSE = "The Client shall pay $3,000 (Venue deposit) upon signing this agreement.";
const pages = [`Venue Rental Agreement\n${CLAUSE}\nPage 1 of 2`, "Cancellation by the Client: with at least 90 days' written notice, 50% of payments made will be refunded."];

const ok = (page: number) => ({ verified: true, page });
const no = (reason: "empty" | "too_short" | "not_found") => ({ verified: false, page: null, reason });

describe("verifyQuote: matches", () => {
  it("finds an exact quote and reports its page", () => {
    expect(verifyQuote(pages, CLAUSE)).toEqual(ok(1));
    expect(verifyQuote(pages, "with at least 90 days' written notice, 50% of payments made")).toEqual(ok(2));
  });

  it("ignores line breaks and runs of whitespace", () => {
    const text = ["The Client shall pay\n   $3,000   (Venue\ndeposit)\tupon signing this agreement."];
    expect(verifyQuote(text, CLAUSE)).toEqual(ok(1));
    expect(verifyQuote([CLAUSE], "The Client  shall\npay $3,000 (Venue deposit)")).toEqual(ok(1));
  });

  it("ignores case", () => {
    expect(verifyQuote(pages, CLAUSE.toUpperCase())).toEqual(ok(1));
    expect(verifyQuote(pages, CLAUSE.toLowerCase())).toEqual(ok(1));
  });

  it("treats curly and straight quotes as the same, both ways", () => {
    expect(verifyQuote(pages, "with at least 90 days’ written notice, 50% of payments")).toEqual(ok(2));
    expect(verifyQuote(["the “Client” agrees to the terms here"], 'the "Client" agrees to the terms')).toEqual(ok(1));
    expect(verifyQuote(["the Client’s deposit is payable now"], "the Client's deposit is payable")).toEqual(ok(1));
  });

  it("treats hyphen, en dash, em dash and minus as the same", () => {
    const text = ["Notice of 30 days – 60 days applies in the venue contract"];
    expect(verifyQuote(text, "Notice of 30 days - 60 days applies")).toEqual(ok(1));
    expect(verifyQuote(text, "Notice of 30 days — 60 days applies")).toEqual(ok(1));
    expect(verifyQuote(text, "Notice of 30 days − 60 days applies")).toEqual(ok(1));
  });

  it("handles non-breaking spaces, ligatures and invisible characters", () => {
    expect(verifyQuote(["The ﬁnal balance is due upon signing"], "The final balance is due upon signing")).toEqual(ok(1));
    expect(verifyQuote(["The final balance is due​ upon signing"], "The final balance is due upon signing")).toEqual(ok(1));
    expect(verifyQuote(["The fi­nal balance is due upon signing"], "The final balance is due upon signing")).toEqual(ok(1));
  });

  it("handles a real hyphen split across a line break", () => {
    const text = ["The deposit is non-\nrefundable and applies to the venue."];
    expect(verifyQuote(text, "The deposit is non-refundable and applies")).toEqual(ok(1));
  });

  it("handles a word split by hyphenation across a line break", () => {
    const text = ["Payments made will be refund-\n  able upon written request."];
    expect(verifyQuote(text, "Payments made will be refundable upon written")).toEqual(ok(1));
  });

  it("reports the first page that contains the quote", () => {
    const text = ["nothing relevant here at all", "the balance is due in full", "the balance is due in full"];
    expect(verifyQuote(text, "the balance is due in full")).toEqual(ok(2));
  });

  it("finds a quote on a later page even if the model claimed another", () => {
    expect(verifyQuote(["page one text", "page two text", "Addendum A: refunds apply to payments"], "Addendum A: refunds apply to payments")).toEqual(ok(3));
  });

  it("allows a number to end a sentence", () => {
    expect(verifyQuote(["The fee is $1,000. Payment is due on signing."], "The fee is $1,000")).toEqual(ok(1));
  });
});

describe("verifyQuote: ellipses", () => {
  const text = ["Notice of at least 90 days entitles the Client to 50% of all sums paid back, less a non-refundable fee of $100."];

  it("accepts skipped text with three dots or an ellipsis character", () => {
    expect(verifyQuote(text, "Notice of at least 90 days ... less a non-refundable fee of $100")).toEqual(ok(1));
    expect(verifyQuote(text, "Notice of at least 90 days…less a non-refundable fee of $100")).toEqual(ok(1));
    expect(verifyQuote(text, "Notice of at least 90 days...50% of all sums paid back...fee of $100")).toEqual(ok(1));
  });

  it("requires the pieces in order", () => {
    expect(verifyQuote(text, "less a non-refundable fee of $100 ... Notice of at least 90 days")).toEqual(no("not_found"));
  });

  it("requires every piece on the same page", () => {
    const split = ["Notice of at least 90 days entitles the Client", "to 50% of all sums paid back"];
    expect(verifyQuote(split, "Notice of at least 90 days entitles ... to 50% of all sums paid back")).toEqual(no("not_found"));
  });

  it("does not let an ellipsis smuggle in a short quote", () => {
    expect(verifyQuote(text, "the ... fee")).toEqual(no("too_short"));
  });
});

describe("verifyQuote: near misses must fail", () => {
  it("rejects a changed amount", () => {
    expect(verifyQuote(pages, CLAUSE.replace("$3,000", "$30,000"))).toEqual(no("not_found"));
    expect(verifyQuote(pages, CLAUSE.replace("$3,000", "$2,000"))).toEqual(no("not_found"));
  });

  it("does not ignore punctuation inside a number", () => {
    const text = ["The Client shall pay $1,000 upon signing this agreement."];
    expect(verifyQuote(text, "The Client shall pay $1000 upon signing")).toEqual(no("not_found"));
    expect(verifyQuote(text, "The Client shall pay $10.00 upon signing")).toEqual(no("not_found"));
    expect(verifyQuote(text, "The Client shall pay $1,000 upon signing")).toEqual(ok(1));
  });

  it("rejects a changed number of days or percent", () => {
    expect(verifyQuote(pages, "with at least 60 days' written notice, 50% of payments made")).toEqual(no("not_found"));
    expect(verifyQuote(pages, "with at least 90 days' written notice, 75% of payments made")).toEqual(no("not_found"));
  });

  it("rejects a quote that stops inside a longer number", () => {
    expect(verifyQuote(["The Client shall pay $1,000.50 upon signing."], "The Client shall pay $1,000")).toEqual(no("not_found"));
    expect(verifyQuote(["The Client shall pay $1,000,500 upon signing."], "The Client shall pay $1,000")).toEqual(no("not_found"));
    expect(verifyQuote(["The Client shall pay $300 upon signing."], "The Client shall pay $30")).toEqual(no("not_found"));
  });

  it("rejects a quote that starts inside a longer number", () => {
    expect(verifyQuote(["The total is $13,000 for the venue."], "total is $13,000 for")).toEqual(ok(1));
    expect(verifyQuote(["The total is $13,000 for the venue."], "3,000 for the venue")).toEqual(no("not_found"));
    expect(verifyQuote(["The total is $1.3,000 for the venue."], "3,000 for the venue")).toEqual(no("not_found"));
  });

  it("rejects a quote that stops or starts inside a word", () => {
    expect(verifyQuote(["The Client shall pay the deposit upon signing."], "The Client shall pay the depo")).toEqual(no("not_found"));
    expect(verifyQuote(["The Client shall pay the deposit upon signing."], "lient shall pay the deposit upon")).toEqual(no("not_found"));
  });

  it("rejects inserted, missing or reordered words", () => {
    expect(verifyQuote(pages, "The Client shall promptly pay $3,000 (Venue deposit) upon signing")).toEqual(no("not_found"));
    expect(verifyQuote(pages, "The Client shall pay $3,000 (Venue deposit) signing this agreement")).toEqual(no("not_found"));
    expect(verifyQuote(pages, "upon signing this agreement the Client shall pay $3,000")).toEqual(no("not_found"));
  });
});

describe("verifyQuote: unverifiable input", () => {
  it("rejects fabricated quotes", () => {
    expect(verifyQuote(pages, "The Company guarantees a full refund in all circumstances.")).toEqual(no("not_found"));
  });

  it("rejects empty quotes", () => {
    expect(verifyQuote(pages, "")).toEqual(no("empty"));
    expect(verifyQuote(pages, "   \n\t ")).toEqual(no("empty"));
    expect(verifyQuote(pages, "...")).toEqual(no("empty"));
  });

  it("rejects quotes too short to prove anything", () => {
    expect(verifyQuote(pages, "the")).toEqual(no("too_short"));
    expect(verifyQuote(pages, "The Client")).toEqual(no("too_short"));
  });

  it("accepts a quote of exactly the minimum length", () => {
    const quote = "The Client s"; // 12 characters
    expect(MIN_QUOTE_LENGTH).toBe(12);
    expect(quote).toHaveLength(MIN_QUOTE_LENGTH);
    expect(verifyQuote(["xx The Client shall"], quote)).toEqual(no("not_found")); // 's' ends mid-word
    expect(verifyQuote(["The Client s"], quote)).toEqual(ok(1));
  });

  it("returns not_found when there are no pages", () => {
    expect(verifyQuote([], CLAUSE)).toEqual(no("not_found"));
  });
});

describe("verifyQuote on the real sample contracts", () => {
  it("verifies every seeded clause on its recorded page", async () => {
    let checked = 0;
    for (const spec of VENDORS) {
      const bytes = await readFile(path.join(process.cwd(), "seed", "contracts", `${spec.slug}.pdf`));
      const contractPages = await extractPdfPages(bytes);
      const clauses = buildVendorClauses(spec, vendorStyle(spec, VENDORS));
      for (const c of [...clauses.payments, clauses.cancellation, clauses.dateChange]) {
        expect(verifyQuote(contractPages, c.text), `${spec.slug}: ${c.text}`).toEqual(ok(c.page));
        checked++;
      }
    }
    expect(checked).toBe(23 + 14 + 14);
  }, 60_000);

  it("rejects the same clauses with one digit changed", async () => {
    const spec = VENDORS.find((v) => v.slug === "grand-oak-estate")!;
    const bytes = await readFile(path.join(process.cwd(), "seed", "contracts", `${spec.slug}.pdf`));
    const contractPages = await extractPdfPages(bytes);
    const clauses = buildVendorClauses(spec, vendorStyle(spec, VENDORS));
    for (const c of [...clauses.payments, clauses.cancellation, clauses.dateChange]) {
      const tampered = c.text.replace(/\d/, (d) => String((Number(d) + 1) % 10));
      expect(tampered).not.toBe(c.text);
      expect(verifyQuote(contractPages, tampered).verified, tampered).toBe(false);
    }
  }, 30_000);
});
