import type { PrismaClient } from "@/generated/prisma/client";
import { formatCents } from "@/lib/money";
import { cancellationRulesSchema, dateChangeRulesSchema } from "@/lib/rules";
import { computeDueDate } from "@/lib/schedule";
import { describeCancellationTiers, describeDateChangeTiers } from "@/lib/vendors/page-data";

/** What the printable "payment summary" for a vendor shows. Plain data. */
export type VendorSummary = {
  coupleNames: string;
  weddingDateLabel: string;
  preparedLabel: string;
  vendor: { name: string; category: string; totalLabel: string; signingDateLabel: string; notes: string; entered: "by_hand" | "from_contract" };
  payments: { label: string; amountLabel: string; dueDateLabel: string; basis: string }[];
  cancellationTiers: string[];
  dateChangeTiers: string[];
};

const longDate = (date: Date) => date.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** How a payment's due date was fixed, in words: "30 days before the wedding", "On signing", "On June 1, 2027". */
export function describePaymentBasis(p: { anchor: "wedding_date" | "signing_date" | "fixed"; offsetDays: number }, fixedDate: Date | null): string {
  if (p.anchor === "fixed") return fixedDate ? `On ${longDate(fixedDate)}` : "On a set date";
  const days = Math.abs(p.offsetDays);
  if (p.anchor === "signing_date") return days === 0 ? "On signing" : `${plural(days, "day")} after signing`;
  if (p.offsetDays === 0) return "On the wedding day";
  return `${plural(days, "day")} ${p.offsetDays < 0 ? "before" : "after"} the wedding`;
}

/** The summary for one vendor, only if it belongs to this wedding (someone else's id is a null, like one that doesn't exist). */
export async function loadVendorSummary(prisma: PrismaClient, weddingId: string, vendorId: string, now: Date = new Date()): Promise<VendorSummary | null> {
  const vendor = await prisma.vendor.findFirst({ where: { id: vendorId, weddingId }, include: { wedding: true, payments: true, terms: true } });
  if (!vendor) return null;

  const anchors = { weddingDate: vendor.wedding.date, signingDate: vendor.signingDate };
  const payments = vendor.payments
    .map((p) => ({ p, due: computeDueDate(p, anchors) }))
    .sort((a, b) => a.due.getTime() - b.due.getTime() || a.p.label.localeCompare(b.p.label))
    .map(({ p, due }) => ({
      label: p.label,
      amountLabel: formatCents(p.amount),
      dueDateLabel: longDate(due),
      basis: describePaymentBasis(p, p.fixedDate),
    }));

  const cancellation = cancellationRulesSchema.safeParse(vendor.terms?.cancellationRules).data ?? [];
  const dateChange = dateChangeRulesSchema.safeParse(vendor.terms?.dateChangeRules).data ?? [];

  return {
    coupleNames: vendor.wedding.coupleNames,
    weddingDateLabel: longDate(vendor.wedding.date),
    preparedLabel: longDate(now),
    vendor: {
      name: vendor.name,
      category: vendor.category,
      totalLabel: formatCents(vendor.totalCost),
      signingDateLabel: longDate(vendor.signingDate),
      notes: vendor.notes,
      entered: vendor.contractPath ? "from_contract" : "by_hand",
    },
    payments,
    cancellationTiers: describeCancellationTiers(cancellation),
    dateChangeTiers: describeDateChangeTiers(dateChange, vendor.totalCost),
  };
}
