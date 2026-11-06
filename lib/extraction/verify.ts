import type { ExtractedEvidence, ExtractedTerms, PaymentTerm } from "@/lib/extraction/terms";
import { verifyQuote } from "@/lib/quotes";

/** Terms the model is less sure of than this are shown to the user to confirm. */
export const CONFIDENCE_THRESHOLD = 0.8;

export type Checked<T> = T & {
  quoteVerified: boolean;
  /** Show this to the user to confirm before it is saved. */
  needsReview: boolean;
};

export type VerifiedTerms = Omit<ExtractedTerms, "payments" | "cancellation" | "dateChange"> & {
  payments: Checked<PaymentTerm>[];
  cancellation: Checked<ExtractedTerms["cancellation"]>;
  dateChange: Checked<ExtractedTerms["dateChange"]>;
  /** How many quotes were checked and how many really appear in the PDF. */
  quoteChecks: { total: number; verified: number };
};

/**
 * Check one term's quote against the PDF.
 * - Verified: the page becomes the page the quote was actually found on.
 * - Not found: confidence drops to 0, because the evidence is not in the document.
 * Either way a term below the confidence threshold needs review.
 */
export function checkEvidence<T extends ExtractedEvidence>(item: T, pages: readonly string[]): Checked<T> {
  const check = verifyQuote(pages, item.clauseQuote);
  if (check.verified) {
    return { ...item, page: check.page, quoteVerified: true, needsReview: item.confidence < CONFIDENCE_THRESHOLD };
  }
  return { ...item, confidence: 0, quoteVerified: false, needsReview: true };
}

/** Verify every quote in the extracted terms against the contract's page text. */
export function verifyTerms(terms: ExtractedTerms, pages: readonly string[]): VerifiedTerms {
  const payments = terms.payments.map((p) => checkEvidence(p, pages));

  // A term the contract does not have has no quote to check and nothing to confirm.
  const optional = <T extends ExtractedEvidence & { found: boolean }>(term: T): Checked<T> =>
    term.found ? checkEvidence(term, pages) : { ...term, quoteVerified: false, needsReview: false };

  const cancellation = optional(terms.cancellation);
  const dateChange = optional(terms.dateChange);

  const checked = [...payments, ...(cancellation.found ? [cancellation] : []), ...(dateChange.found ? [dateChange] : [])];
  return {
    ...terms,
    payments,
    cancellation,
    dateChange,
    quoteChecks: { total: checked.length, verified: checked.filter((c) => c.quoteVerified).length },
  };
}
