import { formatCents } from "@/lib/money";
import { parsePayload, type ProposalKind } from "@/lib/proposals/payloads";
import { clauseHref } from "@/lib/vendors/links";

/** What a proposal card shows. Plain data, so it can cross from server to browser. */
export type ProposalView = {
  id: string;
  kind: ProposalKind;
  title: string;
  /** What will happen if approved, in one sentence. */
  summary: string;
  amount: { label: string; caption: string } | null;
  /** Supporting lines: the calculation, the dates, the per-vendor fees. */
  details: string[];
  /** For a refund request: the drafted message to send the vendor. */
  draft: string | null;
  /** Why the assistant proposed it. */
  reason: string;
  /** "Grand Oak Estate contract, page 2": the clause it rests on, in words. */
  citation: string | null;
  /** The vendor page opened at that clause. */
  clauseHref: string | null;
  /** For a "pay" proposal: the payment the PayPal button pays. */
  paymentId: string | null;
  /** False if the stored details can't be read: the card can be dismissed but not approved. */
  approvable: boolean;
  createdAt: string;
};

/** `2027-06-12` as `Jun 12, 2027`. */
export function formatIsoDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}

export type ProposalRow = {
  id: string;
  kind: ProposalKind;
  payload: unknown;
  createdAt: Date;
  clause: { id: string; vendorId: string; page: number; vendor: { name: string } } | null;
};

export function toProposalView(row: ProposalRow): ProposalView {
  const base = {
    id: row.id,
    kind: row.kind,
    citation: row.clause ? `${row.clause.vendor.name} contract, page ${row.clause.page}` : null,
    clauseHref: row.clause ? clauseHref(row.clause.vendorId, row.clause.id) : null,
    createdAt: row.createdAt.toISOString(),
  };
  const parsed = parsePayload(row.kind, row.payload);

  if (!parsed) {
    return {
      ...base,
      title: "Unreadable proposal",
      summary: "The details of this proposal couldn't be read, so it can't be approved. You can dismiss it.",
      amount: null,
      details: [],
      draft: null,
      reason: "",
      paymentId: null,
      approvable: false,
    };
  }

  switch (parsed.kind) {
    case "pay": {
      const p = parsed.payload;
      return {
        ...base,
        title: `Pay ${p.vendorName}`,
        summary: `${p.label}, due ${formatIsoDate(p.dueDate)}.`,
        amount: { label: formatCents(p.amountCents), caption: "to pay now" },
        details: [],
        draft: null,
        reason: p.reason,
        paymentId: p.paymentId,
        approvable: true,
      };
    }

    case "reschedule": {
      const p = parsed.payload;
      return {
        ...base,
        title: "Move the wedding",
        summary: `From ${formatIsoDate(p.previousDate)} to ${formatIsoDate(p.newDate)}. Every payment date moves with it.`,
        amount:
          p.totalCostCents > 0
            ? { label: formatCents(p.totalCostCents), caption: "in vendor change fees" }
            : { label: "$0", caption: "no change fees" },
        details: p.charges.map((c) => `${c.vendorName}: ${formatCents(c.costCents)}`),
        draft: null,
        reason: p.reason,
        paymentId: null,
        approvable: true,
      };
    }

    case "refund_request": {
      const p = parsed.payload;
      return {
        ...base,
        title: "Request a refund",
        summary: `Ask ${p.vendorName} for ${formatCents(p.owedCents)} back of the ${formatCents(p.paidCents)} paid.`,
        amount: { label: formatCents(p.owedCents), caption: "to ask back" },
        details: [p.calculation, `Cancelled by ${p.cancelledBy === "vendor" ? "the vendor" : "you"} on ${formatIsoDate(p.cancellationDate)}.`].filter(Boolean),
        draft: p.message,
        reason: p.reason,
        paymentId: null,
        approvable: true,
      };
    }

    case "message": {
      const p = parsed.payload;
      return { ...base, title: "A note for you", summary: p.text, amount: null, details: [], draft: null, reason: p.reason, paymentId: null, approvable: true };
    }
  }
}
