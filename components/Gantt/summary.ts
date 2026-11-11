import { formatCents } from "@/lib/money";

/**
 * The Gantt's Summary footer: how much cash each month needs. The amounts come
 * from `TimelineData.cashByMonth` (lib/timeline.ts, due dates from
 * lib/schedule.ts); this only formats them. Plain functions, so they are tested
 * without Bryntum. Everything rendered is our own formatted money, never
 * user or contract text.
 */

/** `2027-03` for the month a Bryntum tick starts in. Its dates are local midnights. */
export const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

/** `$950`, `$3,000`, `$12.5k`: short enough for a 64px month column. */
export function shortMoney(cents: number): string {
  if (cents < 1_000_000) return formatCents(Math.round(cents / 100) * 100);
  const thousands = cents / 100_000;
  return `$${thousands >= 100 ? Math.round(thousands) : Math.round(thousands * 10) / 10}k`;
}

const monthName = (key: string) =>
  new Date(`${key}-01T00:00:00.000Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });

/** The busiest month's amount: months at it are highlighted as the cash-flow peak. */
export const peakCents = (cashByMonth: Record<string, number>) => Math.max(0, ...Object.values(cashByMonth));

/** One footer cell. Empty for a month with nothing due. */
export function renderCashCell(cashByMonth: Record<string, number>, key: string): string {
  const cents = cashByMonth[key] ?? 0;
  if (cents <= 0) return "";
  const peak = cents === peakCents(cashByMonth);
  const title = `${formatCents(cents)} due in ${monthName(key)}${peak ? " (the busiest month)" : ""}`;
  return `<span class="vw-cash${peak ? " vw-cash-peak" : ""}" title="${title}" aria-label="${title}">${shortMoney(cents)}</span>`;
}

/** The total still to pay, for the Amount column's footer. */
export const totalCash = (cashByMonth: Record<string, number>) => Object.values(cashByMonth).reduce((sum, c) => sum + c, 0);
