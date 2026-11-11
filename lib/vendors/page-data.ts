import { findInjection } from "@/lib/injection";
import type { PrismaClient } from "@/generated/prisma/client";
import { formatCents, percentOf } from "@/lib/money";
import { cancellationRulesSchema, clauseIdsSchema, dateChangeRulesSchema, type CancellationRule, type DateChangeRule } from "@/lib/rules";
import { computeDueDate, getDisplayStatus, type DisplayStatus } from "@/lib/schedule";
import { STATUS_LABEL } from "@/lib/timeline";
import { readContractPages } from "@/lib/vendors/contract-file";
import { contractPdfHref } from "@/lib/vendors/links";

/** Everything the vendor page shows. Plain data, so it can cross to the browser. */

export type ClauseKind = "payment" | "cancellation" | "date_change" | "other";

export type ViewerClause = { id: string; kind: ClauseKind; text: string; page: number; summary: string };

export type PaymentTermView = {
  id: string;
  label: string;
  amountLabel: string;
  dueDateLabel: string;
  status: DisplayStatus;
  statusLabel: string;
  clauseId: string | null;
};

/** One rule group (cancellation or date change): its tiers in words and the clause they come from. */
export type RuleTermView = { clauseId: string | null; tiers: string[] };

export type VendorPageData = {
  vendor: {
    id: string;
    name: string;
    category: string;
    status: "active" | "cancelled";
    totalLabel: string;
    pdfUrl: string;
    /** Typed in by the couple: there is no contract on file, so no PDF and no clauses to show. */
    manual: boolean;
  };
  weddingDateLabel: string;
  /** Text of each contract page; null if the PDF can't be read. */
  pages: string[] | null;
  clauses: ViewerClause[];
  payments: PaymentTermView[];
  cancellation: RuleTermView;
  dateChange: RuleTermView;
  /** Clauses with text addressed to an AI assistant (lib/injection.ts), to warn the couple about. */
  suspicious: { clauseId: string; page: number; warning: string }[];
};

const longDate = (date: Date) => date.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });

const KIND_ORDER: Record<ClauseKind, number> = { payment: 0, cancellation: 1, date_change: 2, other: 3 };

const notice = (days: number) => (days === 0 ? "Any notice" : `${days}+ days' notice`);

/** "90+ days' notice: 50% of payments made refunded, less $100". Highest notice first. */
export function describeCancellationTiers(rules: CancellationRule[]): string[] {
  return [...rules]
    .sort((a, b) => b.minNoticeDays - a.minNoticeDays)
    .map((r) => {
      const refund = r.refundPercent === 0 ? "no refund" : `${r.refundPercent}% of payments made refunded`;
      const fee = r.flatFee > 0 ? `, less ${formatCents(r.flatFee)}` : "";
      return `${notice(r.minNoticeDays)}: ${refund}${fee}`;
    });
}

/** "120+ days' notice: 5% of the contract price ($450)". The amount is computed here, in code. */
export function describeDateChangeTiers(rules: DateChangeRule[], totalCents: number): string[] {
  return [...rules]
    .sort((a, b) => b.minNoticeDays - a.minNoticeDays)
    .map((r) => {
      const feeCents = percentOf(totalCents, r.feePercent) + r.flatFee;
      if (feeCents === 0) return `${notice(r.minNoticeDays)}: free`;
      const parts = [r.feePercent > 0 ? `${r.feePercent}% of the contract price` : null, r.flatFee > 0 ? `${formatCents(r.flatFee)} flat` : null].filter(Boolean);
      return `${notice(r.minNoticeDays)}: ${parts.join(" + ")} (${formatCents(feeCents)})`;
    });
}

type Deps = {
  today?: Date;
  /** Override for tests; defaults to reading the PDF from disk. */
  readPages?: (contractPath: string) => Promise<string[] | null>;
};

/** The vendor page's data, or null when this wedding has no such vendor (someone else's id counts as none). Server only. */
export async function loadVendorPage(prisma: PrismaClient, weddingId: string, vendorId: string, deps: Deps = {}): Promise<VendorPageData | null> {
  const vendor = await prisma.vendor.findFirst({
    where: { id: vendorId, weddingId },
    include: { wedding: true, clauses: true, payments: true, terms: true },
  });
  if (!vendor) return null;

  const today = deps.today ?? new Date();
  const anchors = { weddingDate: vendor.wedding.date, signingDate: vendor.signingDate };

  const clauses: ViewerClause[] = [...vendor.clauses]
    .sort((a, b) => a.page - b.page || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id.localeCompare(b.id))
    .map((c) => ({ id: c.id, kind: c.kind, text: c.text, page: c.page, summary: c.summary }));
  const clauseIds = new Set(clauses.map((c) => c.id));

  const payments = vendor.payments
    .map((p) => ({ p, due: computeDueDate(p, anchors) }))
    .sort((a, b) => a.due.getTime() - b.due.getTime() || a.p.label.localeCompare(b.p.label))
    .map(({ p, due }): PaymentTermView => {
      const status = getDisplayStatus(p.status, due, today);
      return {
        id: p.id,
        label: p.label,
        amountLabel: formatCents(p.amount),
        dueDateLabel: longDate(due),
        status,
        statusLabel: STATUS_LABEL[status],
        clauseId: p.clauseId && clauseIds.has(p.clauseId) ? p.clauseId : null,
      };
    });

  // Terms list their clauses without saying which is which; the clause kind does.
  const termClauseIds = vendor.terms ? (clauseIdsSchema.safeParse(vendor.terms.clauseIds).data ?? []) : [];
  const clauseFor = (kind: ClauseKind) =>
    (clauses.find((c) => c.kind === kind && termClauseIds.includes(c.id)) ?? clauses.find((c) => c.kind === kind))?.id ?? null;

  const cancellationRules = cancellationRulesSchema.safeParse(vendor.terms?.cancellationRules).data ?? [];
  const dateChangeRules = dateChangeRulesSchema.safeParse(vendor.terms?.dateChangeRules).data ?? [];

  return {
    vendor: {
      id: vendor.id,
      name: vendor.name,
      category: vendor.category,
      status: vendor.status,
      totalLabel: formatCents(vendor.totalCost),
      pdfUrl: contractPdfHref(vendor.id),
      manual: vendor.contractPath === "",
    },
    weddingDateLabel: longDate(vendor.wedding.date),
    pages: await (deps.readPages ?? ((p: string) => readContractPages(p)))(vendor.contractPath),
    clauses,
    payments,
    cancellation: { clauseId: clauseFor("cancellation"), tiers: describeCancellationTiers(cancellationRules) },
    dateChange: { clauseId: clauseFor("date_change"), tiers: describeDateChangeTiers(dateChangeRules, vendor.totalCost) },
    suspicious: clauses.flatMap((c) => {
      const finding = findInjection(c.text);
      return finding ? [{ clauseId: c.id, page: c.page, warning: finding.warning }] : [];
    }),
  };
}
