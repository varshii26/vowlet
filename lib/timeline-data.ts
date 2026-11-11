import type { PrismaClient } from "@/generated/prisma/client";
import type { DeadlineTerms } from "@/lib/deadlines";
import { cancellationRulesSchema, dateChangeRulesSchema } from "@/lib/rules";
import type { TimelineInput } from "@/lib/timeline";

/**
 * Load the wedding, its vendors and their payments for the timeline. Returns
 * null when there is no wedding yet. Server only: it reads the database.
 */
export async function loadTimelineInput(prisma: PrismaClient, weddingId: string): Promise<TimelineInput | null> {
  const wedding = await prisma.wedding.findUnique({
    where: { id: weddingId },
    include: {
      vendors: {
        orderBy: { name: "asc" },
        include: {
          payments: { include: { clause: true }, orderBy: { label: "asc" } },
          terms: true,
          clauses: { where: { kind: { in: ["cancellation", "date_change"] } }, select: { id: true, kind: true, page: true } },
        },
      },
    },
  });
  if (!wedding) return null;

  return {
    wedding: { coupleNames: wedding.coupleNames, date: wedding.date },
    vendors: wedding.vendors.map((vendor) => ({
      id: vendor.id,
      name: vendor.name,
      status: vendor.status,
      signingDate: vendor.signingDate,
      terms: deadlineTerms(vendor.terms, vendor.clauses),
      payments: vendor.payments.map((payment) => ({
        id: payment.id,
        label: payment.label,
        amountCents: payment.amount,
        anchor: payment.anchor,
        offsetDays: payment.offsetDays,
        fixedDate: payment.fixedDate,
        status: payment.status,
        clause: payment.clause
          ? { id: payment.clause.id, summary: payment.clause.summary, page: payment.clause.page, text: payment.clause.text }
          : null,
      })),
    })),
  };
}

type StoredTerms = { cancellationRules: unknown; dateChangeRules: unknown } | null;
type TermsClause = { id: string; kind: string; page: number };

/** The vendor's terms for the deadline indicators. Stored JSON is validated; bad or missing rules mean no deadlines. */
function deadlineTerms(terms: StoredTerms, clauses: TermsClause[]): DeadlineTerms | undefined {
  if (!terms) return undefined;
  const cancellation = cancellationRulesSchema.safeParse(terms.cancellationRules);
  const dateChange = dateChangeRulesSchema.safeParse(terms.dateChangeRules);
  const clause = (kind: string) => {
    const found = clauses.find((c) => c.kind === kind);
    return found ? { id: found.id, page: found.page } : null;
  };
  return {
    cancellation: cancellation.success ? cancellation.data : [],
    dateChange: dateChange.success ? dateChange.data : [],
    cancellationClause: clause("cancellation"),
    dateChangeClause: clause("date_change"),
  };
}
