import type { ContractExtraction } from "@/lib/extraction/schema";
import { decimalStringToCents, percentOf } from "@/lib/money";
import {
  cancellationRulesSchema,
  dateChangeRulesSchema,
  type CancellationRule,
  type DateChangeRule,
} from "@/lib/rules";

/**
 * The model's output as exact terms: dollars become integer cents, percent
 * payments become cents of the total, and rule tiers are validated. All the
 * arithmetic happens here, in code. Model output is untrusted, so anything
 * malformed is reported as an error rather than guessed at.
 */

export type ExtractedEvidence = { clauseQuote: string; page: number; confidence: number };

export type PaymentTerm = ExtractedEvidence & {
  label: string;
  amountCents: number;
  anchor: "wedding_date" | "signing_date" | "fixed";
  offsetDays: number;
  /** `YYYY-MM-DD` for fixed payments, otherwise null. */
  fixedDate: string | null;
};

export type ExtractedTerms = {
  vendorName: string;
  category: string;
  totalCents: number;
  payments: PaymentTerm[];
  cancellation: ExtractedEvidence & { found: boolean; rules: CancellationRule[] };
  dateChange: ExtractedEvidence & { found: boolean; rules: DateChangeRule[] };
};

export type TermsResult = { ok: true; terms: ExtractedTerms } | { ok: false; errors: string[] };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PLAIN_NUMBER = /^\d+(?:\.\d+)?$/;

function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Plain dollars to cents, or an error message that says which field was bad. */
function dollars(value: string, what: string, errors: string[]): number {
  const text = value.trim();
  if (text !== "" && /^\d+(?:\.\d{1,2})?$/.test(text)) {
    const cents = decimalStringToCents(text);
    if (Number.isSafeInteger(cents)) return cents;
  }
  errors.push(`${what}: "${value}" is not a plain dollar amount`);
  return 0;
}

export function toTerms(extraction: ContractExtraction): TermsResult {
  const errors: string[] = [];
  const totalCents = dollars(extraction.totalAmount, "total", errors);

  const payments = extraction.payments.map((p): PaymentTerm => {
    const name = `payment "${p.label}"`;
    let amountCents = 0;

    if (p.amountType === "fixed") {
      amountCents = dollars(p.amount, name, errors);
    } else {
      const percent = p.amount.trim();
      if (!PLAIN_NUMBER.test(percent) || Number(percent) <= 0 || Number(percent) > 100) {
        errors.push(`${name}: "${p.amount}" is not a percentage between 0 and 100`);
      } else if (totalCents <= 0) {
        errors.push(`${name}: a percent payment needs a total contract price`);
      } else {
        amountCents = percentOf(totalCents, Number(percent));
      }
    }
    if (amountCents <= 0 && errors.every((e) => !e.startsWith(name))) errors.push(`${name}: amount must be above zero`);

    let fixedDate: string | null = null;
    if (p.anchor === "fixed") {
      if (isRealDate(p.fixedDate)) fixedDate = p.fixedDate;
      else errors.push(`${name}: a fixed payment needs a real YYYY-MM-DD date, got "${p.fixedDate}"`);
    }

    return {
      label: p.label,
      amountCents,
      anchor: p.anchor,
      offsetDays: p.anchor === "fixed" ? 0 : p.offsetDays,
      fixedDate,
      clauseQuote: p.clauseQuote,
      page: p.page,
      confidence: p.confidence,
    };
  });

  if (extraction.payments.length === 0) errors.push("no payments were extracted");

  const cancellation = (() => {
    const c = extraction.cancellation;
    const rules = c.found
      ? c.tiers.map((t) => ({
          minNoticeDays: t.minNoticeDays,
          refundPercent: t.refundPercent,
          flatFee: dollars(t.flatFee, "cancellation flat fee", errors),
        }))
      : [];
    const checked = cancellationRulesSchema.safeParse(rules);
    if (!checked.success) errors.push("cancellation tiers are invalid");
    if (c.found && rules.length === 0) errors.push("cancellation terms were marked found but have no tiers");
    return { found: c.found, rules: checked.success ? checked.data : [], clauseQuote: c.clauseQuote, page: c.page, confidence: c.confidence };
  })();

  const dateChange = (() => {
    const d = extraction.dateChange;
    const rules = d.found
      ? d.tiers.map((t) => ({
          minNoticeDays: t.minNoticeDays,
          feePercent: t.feePercent,
          flatFee: dollars(t.flatFee, "date-change flat fee", errors),
        }))
      : [];
    const checked = dateChangeRulesSchema.safeParse(rules);
    if (!checked.success) errors.push("date-change tiers are invalid");
    if (d.found && rules.length === 0) errors.push("date-change terms were marked found but have no tiers");
    return { found: d.found, rules: checked.success ? checked.data : [], clauseQuote: d.clauseQuote, page: d.page, confidence: d.confidence };
  })();

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    terms: {
      vendorName: extraction.vendorName,
      category: extraction.category,
      totalCents,
      payments,
      cancellation,
      dateChange,
    },
  };
}
