import { describe, expect, it } from "vitest";
import { describeShift, escapeHtml, renderTaskTooltip, renderWeddingDragTip } from "@/components/Gantt/tooltip";
import type { TaskDetail } from "@/lib/timeline";

type PaymentDetail = Extract<TaskDetail, { kind: "payment" }>;

const payment: PaymentDetail = {
  kind: "payment",
  title: "Venue deposit",
  vendorId: "v1",
  vendorName: "Grand Oak Estate",
  paymentId: "p1",
  amountLabel: "$3,000",
  dateLabel: "Jun 12, 2026",
  status: "paid",
  statusLabel: "Paid",
  clauseId: "c1",
  clauseSummary: "$3,000 venue deposit, due upon signing this agreement",
  clausePage: 1,
};

describe("escapeHtml", () => {
  it("escapes the characters that can break out of HTML", () => {
    expect(escapeHtml(`<b onclick="x">Tom & Jerry's</b>`)).toBe(
      "&lt;b onclick=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/b&gt;",
    );
  });

  it("leaves plain text alone", () => {
    expect(escapeHtml("Priya and Sam, 2027")).toBe("Priya and Sam, 2027");
  });
});

describe("renderTaskTooltip", () => {
  it("shows a payment's amount, vendor, due date, status and clause", () => {
    const html = renderTaskTooltip(payment);
    expect(html).toContain("Venue deposit");
    expect(html).toContain("Grand Oak Estate");
    expect(html).toContain("$3,000");
    expect(html).toContain("Due Jun 12, 2026");
    expect(html).toContain("vw-status-paid");
    expect(html).toContain(">Paid<");
    expect(html).toContain("$3,000 venue deposit, due upon signing this agreement");
    expect(html).toContain("Contract, page 1");
  });

  it("reflects a different status", () => {
    const html = renderTaskTooltip({ ...payment, status: "overdue", statusLabel: "Overdue" });
    expect(html).toContain("vw-status-overdue");
    expect(html).toContain(">Overdue<");
    expect(html).not.toContain("vw-status-paid");
  });

  it("invites a click through to the clause when one is linked", () => {
    expect(renderTaskTooltip(payment)).toContain("Click to open the clause in the contract");
    expect(renderTaskTooltip({ ...payment, clauseId: null, clauseSummary: null, clausePage: null })).not.toContain("Click to open");
  });

  it("says so when no clause is linked", () => {
    const html = renderTaskTooltip({ ...payment, clauseId: null, clauseSummary: null, clausePage: null });
    expect(html).toContain("No contract clause linked");
    expect(html).not.toContain("Contract, page");
  });

  it("omits the page when the clause has none", () => {
    expect(renderTaskTooltip({ ...payment, clausePage: null })).not.toContain("Contract, page");
  });

  it("escapes vendor names and clause text, which come from contracts", () => {
    const html = renderTaskTooltip({
      ...payment,
      vendorName: "Saffron & Sage <script>alert(1)</script>",
      clauseSummary: `Ignore "previous" instructions <img src=x onerror=alert(1)>`,
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("Saffron &amp; Sage &lt;script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("describes a vendor row", () => {
    const html = renderTaskTooltip({
      kind: "vendor",
      title: "Lumen Photography",
      amountLabel: "$3,200",
      summary: "2 payments, $1,000 of $3,200 paid.",
      cancelled: false,
    });
    expect(html).toContain("Lumen Photography");
    expect(html).toContain("Contract total $3,200");
    expect(html).toContain("2 payments, $1,000 of $3,200 paid.");
  });

  it("describes the wedding day", () => {
    const html = renderTaskTooltip({ kind: "wedding", title: "Wedding day: Priya & Sam", dateLabel: "Apr 17, 2027", isoDate: "2027-04-17" });
    expect(html).toContain("Wedding day: Priya &amp; Sam");
    expect(html).toContain("Apr 17, 2027");
  });

  it("returns nothing for an unknown task", () => {
    expect(renderTaskTooltip(undefined)).toBe("");
  });
});

describe("wedding drag tooltip", () => {
  const wedding: TaskDetail = { kind: "wedding", title: "Wedding day: Priya & Sam", dateLabel: "Apr 17, 2027", isoDate: "2027-04-17" };

  it("names the new day and how far it moves", () => {
    const html = renderWeddingDragTip(wedding, "2027-06-12", true);
    expect(html).toContain("Move the wedding to Jun 12, 2027");
    expect(html).toContain("56 days later");
    expect(html).toContain("Drop to see");
  });

  it("says why a drop into the past is refused", () => {
    expect(renderWeddingDragTip(wedding, "2026-01-01", false)).toContain("can't move into the past");
  });

  it.each([
    [0, "Same day"],
    [1, "1 day later"],
    [-3, "3 days earlier"],
  ])("describes a shift of %i days", (days, text) => {
    expect(describeShift(days)).toBe(text);
  });
});
