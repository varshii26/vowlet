import { decimalStringToCents, percentOf } from "@/lib/money";
import type { ExtractedTermsView } from "@/lib/upload/client";
import { reviewedContractSchema, type ReviewedContract } from "@/lib/upload/schema";

/**
 * The upload page's editable form state, and the code that turns it back into
 * a validated `ReviewedContract`. Inputs are kept as the text the couple typed;
 * every amount becomes integer cents here, in code. A payment typed as "25%"
 * is that share of the reviewed total, worked out with `percentOf`.
 */

export type EvidenceDraft = {
  clauseQuote: string;
  page: number;
  confidence: number;
  quoteVerified: boolean;
  /** Low confidence or unverified quote: needs a "Please confirm". */
  flagged: boolean;
  /** Edited, or "I've checked this" ticked. */
  acknowledged: boolean;
};

export type PaymentDraft = EvidenceDraft & {
  label: string;
  /** Dollars ("1500.50") or a share of the total ("25%"). */
  amount: string;
  anchor: "wedding_date" | "signing_date" | "fixed";
  offsetDays: string;
  fixedDate: string;
};

export type TierDraft = { minNoticeDays: string; percent: string; flatFee: string };
export type RulesDraft = EvidenceDraft & { found: boolean; tiers: TierDraft[] };

export type ContractDraft = {
  vendorName: string;
  category: string;
  paypalEmail: string;
  signingDate: string;
  total: string;
  payments: PaymentDraft[];
  cancellation: RulesDraft;
  dateChange: RulesDraft;
};

/** `150050` -> `"1500.50"`, `300000` -> `"3000"`: for an input box. */
export function centsToInput(cents: number): string {
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  return rest === 0 ? String(whole) : `${whole}.${String(rest).padStart(2, "0")}`;
}

/** `"$1,500.50"` -> `150050`, or null when it isn't a plain dollar amount. */
export function parseDollars(text: string): number | null {
  const plain = text.trim().replace(/^\$/, "").replace(/,/g, "");
  try {
    const cents = decimalStringToCents(plain);
    return Number.isSafeInteger(cents) ? cents : null;
  } catch {
    return null;
  }
}

/** A payment amount: dollars, or "25%" of the reviewed total. */
export function parseAmount(text: string, totalCents: number | null): number | null {
  const percent = /^(\d+(?:\.\d+)?)\s*%$/.exec(text.trim());
  if (!percent) return parseDollars(text);
  const value = Number(percent[1]);
  if (totalCents === null || value <= 0 || value > 100) return null;
  return percentOf(totalCents, value);
}

const evidence = (t: { clauseQuote: string; page: number; confidence: number; quoteVerified: boolean; needsReview: boolean }): EvidenceDraft => ({
  clauseQuote: t.clauseQuote,
  page: t.page,
  confidence: t.confidence,
  quoteVerified: t.quoteVerified,
  flagged: t.needsReview,
  acknowledged: false,
});

/** The extraction as an editable form. `today` (YYYY-MM-DD) is the default signing date. */
export function toDraft(terms: ExtractedTermsView, today: string): ContractDraft {
  return {
    vendorName: terms.vendorName,
    category: terms.category,
    paypalEmail: "",
    signingDate: today,
    total: centsToInput(terms.totalCents),
    payments: terms.payments.map((p) => ({
      ...evidence(p),
      label: p.label,
      amount: centsToInput(p.amountCents),
      anchor: p.anchor,
      offsetDays: String(p.offsetDays),
      fixedDate: p.fixedDate ?? "",
    })),
    cancellation: {
      ...evidence(terms.cancellation),
      found: terms.cancellation.found,
      tiers: terms.cancellation.rules.map((r) => ({ minNoticeDays: String(r.minNoticeDays), percent: String(r.refundPercent), flatFee: centsToInput(r.flatFee) })),
    },
    dateChange: {
      ...evidence(terms.dateChange),
      found: terms.dateChange.found,
      tiers: terms.dateChange.rules.map((r) => ({ minNoticeDays: String(r.minNoticeDays), percent: String(r.feePercent), flatFee: centsToInput(r.flatFee) })),
    },
  };
}

/** Readable names of flagged terms the couple hasn't confirmed yet. */
export function pendingConfirmations(draft: ContractDraft): string[] {
  const names: string[] = [];
  draft.payments.forEach((p, i) => {
    if (p.flagged && !p.acknowledged) names.push(p.label.trim() || `Payment ${i + 1}`);
  });
  if (draft.cancellation.found && draft.cancellation.flagged && !draft.cancellation.acknowledged) names.push("Cancellation terms");
  if (draft.dateChange.found && draft.dateChange.flagged && !draft.dateChange.acknowledged) names.push("Date-change terms");
  return names;
}

const int = (text: string): number => (/^-?\d+$/.test(text.trim()) ? Number(text.trim()) : Number.NaN);
const num = (text: string): number => (/^\d+(?:\.\d+)?$/.test(text.trim()) ? Number(text.trim()) : Number.NaN);

export type BuildResult = { ok: true; review: ReviewedContract } | { ok: false; errors: string[] };

/** The form as the confirm request body, or what the couple still needs to fix. */
export function buildReview(draft: ContractDraft): BuildResult {
  const errors: string[] = [];
  const totalCents = parseDollars(draft.total);
  if (totalCents === null) errors.push("Total: enter a dollar amount like 9000 or 1500.50.");

  const payments = draft.payments.map((p, i) => {
    const name = p.label.trim() || `Payment ${i + 1}`;
    const amountCents = parseAmount(p.amount, totalCents);
    if (amountCents === null || amountCents <= 0) errors.push(`${name}: enter an amount like 1500 or 25%.`);
    const offsetDays = p.anchor === "fixed" ? 0 : int(p.offsetDays);
    if (Number.isNaN(offsetDays)) errors.push(`${name}: days must be a whole number.`);
    if (p.anchor === "fixed" && !p.fixedDate) errors.push(`${name}: pick the due date.`);
    return {
      label: p.label,
      amountCents: amountCents ?? 0,
      anchor: p.anchor,
      offsetDays,
      fixedDate: p.anchor === "fixed" ? p.fixedDate : null,
      clauseQuote: p.clauseQuote,
      page: p.page,
      flagged: p.flagged,
      acknowledged: p.acknowledged,
    };
  });

  const tiers = (rules: RulesDraft, what: string) =>
    rules.found
      ? rules.tiers.map((t, i) => {
          const flatFee = parseDollars(t.flatFee);
          const tier = { minNoticeDays: int(t.minNoticeDays), percent: num(t.percent), flatFee: flatFee ?? 0 };
          if (Number.isNaN(tier.minNoticeDays) || tier.minNoticeDays < 0 || Number.isNaN(tier.percent) || tier.percent > 100 || flatFee === null) {
            errors.push(`${what} tier ${i + 1}: use whole days, a percent from 0 to 100 and a dollar fee.`);
          }
          return tier;
        })
      : [];

  const evidenceOf = (r: RulesDraft) => ({ found: r.found, clauseQuote: r.clauseQuote, page: r.page, flagged: r.flagged, acknowledged: r.acknowledged });
  const cancellation = { ...evidenceOf(draft.cancellation), rules: tiers(draft.cancellation, "Cancellation").map((t) => ({ minNoticeDays: t.minNoticeDays, refundPercent: t.percent, flatFee: t.flatFee })) };
  const dateChange = { ...evidenceOf(draft.dateChange), rules: tiers(draft.dateChange, "Date change").map((t) => ({ minNoticeDays: t.minNoticeDays, feePercent: t.percent, flatFee: t.flatFee })) };

  if (errors.length > 0) return { ok: false, errors };

  const parsed = reviewedContractSchema.safeParse({
    vendorName: draft.vendorName,
    category: draft.category,
    paypalEmail: draft.paypalEmail.trim(),
    signingDate: draft.signingDate,
    totalCents,
    payments,
    cancellation,
    dateChange,
  });
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.slice(0, 5).map((i) => `${readablePath(i.path)}: ${i.message}`) };
  }
  return { ok: true, review: parsed.data };
}

function readablePath(path: PropertyKey[]): string {
  const [head, index, field] = path;
  if (head === "payments" && typeof index === "number") return `Payment ${index + 1}${field ? ` (${String(field)})` : ""}`;
  const names: Record<string, string> = {
    vendorName: "Vendor name",
    category: "Category",
    paypalEmail: "PayPal email",
    signingDate: "Signing date",
    totalCents: "Total",
    cancellation: "Cancellation terms",
    dateChange: "Date-change terms",
  };
  return names[String(head)] ?? "Review";
}
