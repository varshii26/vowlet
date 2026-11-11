import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeDueDate, toIsoDate, type PaymentStatus } from "@/lib/schedule";
import { paymentClause } from "@/lib/seed/clauses";
import { VENDORS, WEDDING } from "@/lib/seed/demo-data";
import {
  percentPaid,
  STATUS_COLOR,
  WEDDING_TASK_ID,
  buildTimeline,
  paymentTaskId,
  vendorTaskId,
  withBaseline,
  type TimelineInput,
  type TimelinePayment,
  type TimelineVendor,
} from "@/lib/timeline";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const wedding = d("2027-04-17");
const today = d("2026-11-07");

/** The demo data shaped like the database rows the page loads. */
function demoInput(weddingDate: Date = wedding): TimelineInput {
  const vendors: TimelineVendor[] = VENDORS.map((spec) => ({
    id: `v-${spec.slug}`,
    name: spec.name,
    status: "active",
    signingDate: d(spec.signingDate),
    payments: spec.payments.map((p, i): TimelinePayment => ({
      id: `p-${spec.slug}-${i}`,
      label: p.label,
      amountCents: p.amountCents,
      anchor: p.anchor,
      offsetDays: p.offsetDays ?? 0,
      fixedDate: p.fixedDate ? d(p.fixedDate) : null,
      status: p.anchor === "signing_date" ? "paid" : "scheduled",
      clause: { id: `c-${spec.slug}-${i}`, summary: paymentClause(p).summary, page: 1 },
    })),
  }));
  return { wedding: { coupleNames: WEDDING.coupleNames, date: weddingDate }, vendors };
}

const payment = (over: Partial<TimelinePayment> = {}): TimelinePayment => ({
  id: "p1",
  label: "Deposit",
  amountCents: 100_000,
  anchor: "wedding_date",
  offsetDays: -30,
  fixedDate: null,
  status: "scheduled",
  clause: null,
  ...over,
});
const vendor = (payments: TimelinePayment[], over: Partial<TimelineVendor> = {}): TimelineVendor => ({
  id: "v1",
  name: "Vendor One",
  status: "active",
  signingDate: d("2026-06-12"),
  payments,
  ...over,
});
const single = (p: TimelinePayment, v: Partial<TimelineVendor> = {}): TimelineInput => ({
  wedding: { coupleNames: "Priya & Sam", date: wedding },
  vendors: [vendor([p], v)],
});

describe("buildTimeline on the demo data", () => {
  const data = buildTimeline(demoInput(), today);
  const vendorRows = data.tasks.filter((t) => t.id.startsWith("vendor-"));
  const payments = vendorRows.flatMap((v) => v.children ?? []);

  it("has the wedding day first, then one row per vendor", () => {
    expect(data.tasks[0]).toMatchObject({ id: WEDDING_TASK_ID, startDate: "2027-04-17", duration: 0, cls: "wedding" });
    expect(vendorRows).toHaveLength(14);
    expect(data.tasks).toHaveLength(15);
  });

  it("puts every payment under its vendor as a milestone at its computed due date", () => {
    expect(payments).toHaveLength(23);
    for (const row of vendorRows) {
      const spec = VENDORS.find((v) => `vendor-v-${v.slug}` === row.id)!;
      expect(row.children).toHaveLength(spec.payments.length);
      expect(row.expanded).toBe(false);
      for (const child of row.children!) expect(child.rollup).toBe(true);
    }
    const input = demoInput();
    for (const v of input.vendors) {
      for (const p of v.payments) {
        const task = payments.find((t) => t.id === paymentTaskId(p.id))!;
        const due = computeDueDate(p, { weddingDate: wedding, signingDate: v.signingDate });
        expect(task.startDate).toBe(toIsoDate(due));
        expect(task.duration).toBe(0);
        expect(task.manuallyScheduled).toBe(true);
      }
    }
  });

  it("links every payment to the wedding day", () => {
    expect(data.dependencies).toHaveLength(23);
    for (const dep of data.dependencies) {
      expect([dep.fromTask, dep.toTask]).toContain(WEDDING_TASK_ID);
    }
    expect(new Set(data.dependencies.map((x) => x.id)).size).toBe(23);
  });

  it("orders vendors by their first payment and payments by date", () => {
    const firstDates = vendorRows.map((v) => v.children![0].startDate!);
    expect(firstDates).toEqual([...firstDates].sort());
    for (const row of vendorRows) {
      const dates = row.children!.map((c) => c.startDate!);
      expect(dates).toEqual([...dates].sort());
    }
  });

  it("covers every milestone with padding either side", () => {
    const all = [data.tasks[0], ...payments].map((t) => t.startDate!).sort();
    expect(data.startDate).toBe("2026-05-22"); // earliest 2026-06-12 minus 21 days
    expect(data.endDate).toBe("2027-06-01"); // wedding 2027-04-17 plus 45 days of room to drag it
    expect(data.startDate < all[0]).toBe(true);
    expect(data.endDate > all[all.length - 1]).toBe(true);
  });

  it("has a detail record for every task", () => {
    const ids = [data.tasks[0], ...vendorRows, ...payments].map((t) => t.id);
    expect(Object.keys(data.details).sort()).toEqual([...ids].sort());
  });

  it("survives a JSON round trip, so it can cross from server to client", () => {
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });

  it("is deterministic", () => {
    expect(buildTimeline(demoInput(), today)).toEqual(data);
  });
});

describe("reflow when the wedding moves", () => {
  it("moves wedding-anchored payments and the wedding day, and leaves signing and fixed dates alone", () => {
    const original = buildTimeline(demoInput(), today);
    const moved = buildTimeline(demoInput(d("2027-06-17")), today);
    const dates = (data: typeof original) =>
      Object.fromEntries(data.tasks.flatMap((t) => [t, ...(t.children ?? [])]).map((t) => [t.id, t.startDate]));
    const a = dates(original);
    const b = dates(moved);

    expect(b[WEDDING_TASK_ID]).toBe("2027-06-17");
    expect(b[paymentTaskId("p-grand-oak-estate-1")]).not.toBe(a[paymentTaskId("p-grand-oak-estate-1")]); // wedding -120
    expect(b[paymentTaskId("p-grand-oak-estate-0")]).toBe(a[paymentTaskId("p-grand-oak-estate-0")]); // signing
    expect(b[paymentTaskId("p-dj-marlow-sound-0")]).toBe(a[paymentTaskId("p-dj-marlow-sound-0")]); // fixed
  });
});

describe("the wedding row's label", () => {
  const data = buildTimeline(demoInput(), today);

  it("says what and when, not the couple's names (those are in the page header and the tooltip)", () => {
    expect(data.tasks[0].name).toBe("Wedding day · Apr 17");
    expect(data.details[WEDDING_TASK_ID]).toMatchObject({ title: "Wedding day: Priya & Sam", dateLabel: "Apr 17, 2027" });
  });

  it("follows a what-if move of the wedding", () => {
    expect(buildTimeline(demoInput(d("2027-06-12")), today).tasks[0].name).toBe("Wedding day · Jun 12");
  });
});

describe("vendor progress", () => {
  it("fills each vendor bar by the share of its contract paid, by amount", () => {
    const data = buildTimeline(demoInput(), today);
    const grandOak = data.tasks.find((t) => t.id === vendorTaskId("v-grand-oak-estate"))!;
    // $3,000 deposit of $9,000 paid
    expect(grandOak.percentDone).toBe(33);
    expect(data.details[grandOak.id]).toMatchObject({ percentPaid: 33, progressLabel: "33% paid" });
    const quartet = data.tasks.find((t) => t.id === vendorTaskId("v-velvet-strings-quartet"))!;
    expect(quartet.percentDone).toBe(0);
  });

  it("only reads 100% when fully paid, and says when a vendor is cancelled", () => {
    expect(percentPaid(299_999, 300_000)).toBe(99);
    expect(percentPaid(300_000, 300_000)).toBe(100);
    expect(percentPaid(0, 0)).toBe(0);
    const cancelled = buildTimeline(single(payment({ status: "void" }), { status: "cancelled" }), today);
    expect(cancelled.details[cancelled.tasks[1].id]).toMatchObject({ progressLabel: "Cancelled" });
  });
});

describe("the demo during judging (Dec 1-15, 2026)", () => {
  // The seed's own dates put timing colours on screen for judges: the DJ
  // booking fee (fixed Dec 1) and the venue second installment (Dec 18).
  const statuses = (iso: string) =>
    new Set(
      Object.values(buildTimeline(demoInput(), d(iso)).details).flatMap((x) => (x.kind === "payment" ? [x.status] : [])),
    );

  it("shows a payment due soon on the first day", () => {
    expect(statuses("2026-12-01")).toEqual(new Set(["paid", "scheduled", "due_soon"]));
  });

  it("shows one overdue and one due soon later in the window", () => {
    const later = statuses("2026-12-08");
    expect(later.has("overdue")).toBe(true);
    expect(later.has("due_soon")).toBe(true);
  });
});

describe("contract deadlines on vendor rows", () => {
  const terms = {
    dateChange: [
      { minNoticeDays: 60, feePercent: 0, flatFee: 0 },
      { minNoticeDays: 0, feePercent: 25, flatFee: 0 },
    ],
    cancellation: [
      { minNoticeDays: 90, refundPercent: 50, flatFee: 0 },
      { minNoticeDays: 0, refundPercent: 0, flatFee: 0 },
    ],
    dateChangeClause: { id: "c-change", page: 2 },
    cancellationClause: { id: "c-cancel", page: 2 },
  };
  const deadlinesOf = (data: ReturnType<typeof buildTimeline>) => {
    const detail = data.details[vendorTaskId("v1")];
    return detail.kind === "vendor" ? detail.deadlines : undefined;
  };

  it("gives each vendor its next date-change and cancellation deadline", () => {
    const deadlines = deadlinesOf(buildTimeline(single(payment(), { terms }), today));
    expect(deadlines?.map((x) => [x.kind, x.isoDate, x.clauseId])).toEqual([
      ["date_change", "2027-02-16", "c-change"], // 60 days before 2027-04-17
      ["cancellation", "2027-01-17", "c-cancel"], // 90 days before
    ]);
  });

  it("moves them with the wedding during a what-if", () => {
    const moved = buildTimeline({ ...single(payment(), { terms }), wedding: { coupleNames: "A & B", date: d("2027-06-12") } }, today);
    expect(deadlinesOf(moved)?.[0].isoDate).toBe("2027-04-13");
  });

  it("has none for a cancelled vendor or one without terms", () => {
    expect(deadlinesOf(buildTimeline(single(payment({ status: "void" }), { terms, status: "cancelled" }), today))).toBeUndefined();
    expect(deadlinesOf(buildTimeline(single(payment()), today))).toBeUndefined();
  });
});

describe("withBaseline (what-if ghosts)", () => {
  const flat = (data: ReturnType<typeof buildTimeline>) => data.tasks.flatMap((t) => [t, ...(t.children ?? [])]);
  const base = buildTimeline(demoInput(), today);
  const preview = withBaseline(buildTimeline(demoInput(d("2027-06-12")), today), base);
  const task = (id: string) => flat(preview).find((t) => t.id === id)!;

  it("puts a ghost at the old date on every milestone the preview moved", () => {
    const moved = paymentTaskId("p-grand-oak-estate-1");
    const was = flat(base).find((t) => t.id === moved)!.startDate!;
    expect(task(moved).baselines).toEqual([{ startDate: was, endDate: was, cls: "vw-ghost" }]);
    expect(task(WEDDING_TASK_ID).baselines).toEqual([{ startDate: "2027-04-17", endDate: "2027-04-17", cls: "vw-ghost" }]);
  });

  it("leaves milestones that didn't move, and vendor rows, without a ghost", () => {
    expect(task(paymentTaskId("p-grand-oak-estate-0")).baselines).toBeUndefined(); // signing
    expect(task(paymentTaskId("p-dj-marlow-sound-0")).baselines).toBeUndefined(); // fixed
    expect(task(vendorTaskId("v-grand-oak-estate")).baselines).toBeUndefined();
  });

  it("tells the tooltip where it was and by how much it moved", () => {
    expect(preview.details[WEDDING_TASK_ID]).toMatchObject({ was: { dateLabel: "Apr 17", shiftDays: 56 } });
    const detail = preview.details[paymentTaskId("p-grand-oak-estate-1")];
    expect(detail.kind === "payment" && detail.was?.shiftDays).toBe(56);
    expect(preview.details[paymentTaskId("p-grand-oak-estate-0")]).not.toHaveProperty("was");
  });

  it("keeps both the old and the new dates in the visible range", () => {
    expect(preview.startDate <= base.startDate).toBe(true);
    expect(preview.endDate >= buildTimeline(demoInput(d("2027-06-12")), today).endDate).toBe(true);
  });

  it("opens the vendor rows whose payments moved, so their ghosts are visible", () => {
    expect(task(vendorTaskId("v-grand-oak-estate")).expanded).toBe(true);
    expect(task(vendorTaskId("v-paper-crane-invitations")).expanded).toBe(false); // signing date only, nothing moved
    expect(flat(withBaseline(base, base)).some((t) => t.expanded)).toBe(false);
  });

  it("has no ghosts at all when nothing moved", () => {
    expect(flat(withBaseline(base, base)).some((t) => t.baselines)).toBe(false);
  });
});

describe("payment status colours", () => {
  const cls = (status: PaymentStatus, offsetDays: number, now = today) => {
    const data = buildTimeline(single(payment({ status, offsetDays })), now);
    return data.tasks[1].children![0].cls;
  };

  it("marks a settled payment by its stored status", () => {
    expect(cls("paid", -300)).toBe("payment payment-paid");
    expect(cls("refund_requested", -300)).toBe("payment payment-refund_requested");
    expect(cls("refunded", -300)).toBe("payment payment-refunded");
    expect(cls("void", -300)).toBe("payment payment-void");
  });

  it("marks an unpaid payment overdue, due soon or scheduled by its due date", () => {
    // wedding 2027-04-17; today 2026-11-07
    expect(cls("scheduled", -200)).toBe("payment payment-overdue"); // due 2026-10-03
    expect(cls("scheduled", -161)).toBe("payment payment-due_soon"); // due 2026-11-07 (today)
    expect(cls("scheduled", -147)).toBe("payment payment-due_soon"); // 14 days out
    expect(cls("scheduled", -146)).toBe("payment payment-scheduled"); // 15 days out
  });

  it("reflects a status change when the data is rebuilt", () => {
    expect(cls("scheduled", -30)).toBe("payment payment-scheduled");
    expect(cls("paid", -30)).toBe("payment payment-paid");
  });
});

describe("milestone colours", () => {
  const color = (status: PaymentStatus, offsetDays: number) =>
    buildTimeline(single(payment({ status, offsetDays })), today).tasks[1].children![0].eventColor;

  it("gives each status its own Bryntum colour", () => {
    expect(color("paid", -30)).toBe("green");
    expect(color("scheduled", -200)).toBe("red"); // overdue
    expect(color("scheduled", -161)).toBe("amber"); // due today: due soon
    expect(color("scheduled", -30)).toBe("blue");
    expect(color("refund_requested", -30)).toBe("deep-purple");
    expect(color("refunded", -30)).toBe("teal");
    expect(color("void", -30)).toBe("gray");
  });

  it("uses a distinct colour for every display status", () => {
    expect(new Set(Object.values(STATUS_COLOR)).size).toBe(Object.keys(STATUS_COLOR).length);
  });

  it("colours the wedding day and vendor rows apart from the payments", () => {
    const data = buildTimeline({ wedding: { coupleNames: "A & B", date: wedding }, vendors: [vendor([payment(), payment({ id: "p2", offsetDays: -10 })])] }, today);
    expect(data.tasks[0].eventColor).toBe("pink");
    expect(data.tasks[1].eventColor).toBe("light-gray");
    const cancelled = buildTimeline(single(payment({ status: "void" }), { status: "cancelled" }), today);
    expect(cancelled.tasks[1].eventColor).toBe("lighter-gray");
    expect(Object.values(STATUS_COLOR)).not.toContain(data.tasks[0].eventColor);
  });

  it("colours a single-payment vendor by its payment, whose diamond it covers", () => {
    const data = buildTimeline(single(payment({ status: "paid" })), today);
    expect(data.tasks[1].eventColor).toBe(STATUS_COLOR.paid);
    expect(data.tasks[1].children![0].eventColor).toBe(STATUS_COLOR.paid);
  });

  it("only uses colours that exist in the Gantt stylesheet", () => {
    const css = readFileSync(
      path.join(process.cwd(), "node_modules/@bryntum/gantt-enterprise/gantt.css"),
      "utf8",
    );
    const all = [...Object.values(STATUS_COLOR), "pink", "light-gray", "lighter-gray"];
    for (const name of all) expect(css, name).toContain(`.b-color-${name}`);
  });
});

describe("dependencies around the wedding day", () => {
  const dep = (offsetDays: number) => buildTimeline(single(payment({ offsetDays })), today).dependencies[0];

  it("runs from a payment before the wedding into it", () => {
    expect(dep(-30)).toMatchObject({ fromTask: paymentTaskId("p1"), toTask: WEDDING_TASK_ID });
  });

  it("treats a payment on the wedding day as before it", () => {
    expect(dep(0)).toMatchObject({ fromTask: paymentTaskId("p1"), toTask: WEDDING_TASK_ID });
  });

  it("runs from the wedding to a payment after it", () => {
    expect(dep(14)).toMatchObject({ fromTask: WEDDING_TASK_ID, toTask: paymentTaskId("p1") });
  });
});

describe("task details", () => {
  it("describes a payment with its amount, date, status and clause", () => {
    const clause = { id: "c9", summary: "$1,000 deposit, due upon signing", page: 2 };
    const data = buildTimeline(single(payment({ amountCents: 150_050, offsetDays: -30, clause })), today);
    expect(data.details[paymentTaskId("p1")]).toEqual({
      kind: "payment",
      title: "Deposit",
      vendorId: "v1",
      vendorName: "Vendor One",
      paymentId: "p1",
      amountLabel: "$1,500.50",
      dateLabel: "Mar 18, 2027",
      status: "scheduled",
      statusLabel: "Scheduled",
      clauseId: "c9",
      clauseSummary: "$1,000 deposit, due upon signing",
      clausePage: 2,
      clauseText: null,
    });
  });

  it("allows a payment with no clause", () => {
    const detail = buildTimeline(single(payment()), today).details[paymentTaskId("p1")];
    expect(detail).toMatchObject({ clauseId: null, clauseSummary: null, clausePage: null });
  });

  it("summarises a vendor's total and what is paid", () => {
    const input = single(payment({ amountCents: 100_000 }));
    input.vendors[0].payments.push(payment({ id: "p2", amountCents: 50_000, status: "paid", offsetDays: -90 }));
    const detail = buildTimeline(input, today).details[vendorTaskId("v1")];
    expect(detail).toEqual({
      kind: "vendor",
      vendorId: "v1",
      title: "Vendor One",
      amountLabel: "$1,500",
      summary: "2 payments, $500 of $1,500 paid.",
      cancelled: false,
      percentPaid: 33,
      progressLabel: "33% paid",
    });
  });

  it("uses the singular for one payment", () => {
    const detail = buildTimeline(single(payment()), today).details[vendorTaskId("v1")];
    expect(detail).toMatchObject({ summary: "1 payment, $0 of $1,000 paid." });
  });

  it("marks a cancelled vendor", () => {
    const data = buildTimeline(single(payment({ status: "void" }), { status: "cancelled" }), today);
    expect(data.tasks[1].cls).toBe("vendor vendor-cancelled");
    expect(data.details[vendorTaskId("v1")]).toMatchObject({ cancelled: true, summary: "Cancelled. 1 payment." });
  });

  it("describes the wedding day", () => {
    expect(buildTimeline(single(payment()), today).details[WEDDING_TASK_ID]).toEqual({
      kind: "wedding",
      title: "Wedding day: Priya & Sam",
      dateLabel: "Apr 17, 2027",
      isoDate: "2027-04-17",
    });
  });

  it("lets only the wedding day be dragged, and nothing be resized", () => {
    const data = buildTimeline(single(payment()), today);
    const all = data.tasks.flatMap((task) => [task, ...(task.children ?? [])]);
    expect(all.filter((task) => task.draggable).map((task) => task.id)).toEqual([WEDDING_TASK_ID]);
    expect(all.every((task) => task.resizable === false)).toBe(true);
  });
});

describe("edge cases", () => {
  it("shows just the wedding day when there are no vendors", () => {
    const data = buildTimeline({ wedding: { coupleNames: "A & B", date: wedding }, vendors: [] }, today);
    expect(data.tasks.map((t) => t.id)).toEqual([WEDDING_TASK_ID]);
    expect(data.dependencies).toEqual([]);
    expect(data.startDate).toBe("2027-03-27");
    expect(data.endDate).toBe("2027-06-01");
  });

  it("keeps a vendor with no payments as an empty row", () => {
    const data = buildTimeline({ wedding: { coupleNames: "A & B", date: wedding }, vendors: [vendor([])] }, today);
    expect(data.tasks[1].children).toEqual([]);
  });

  it("widens the range to include a payment after the wedding", () => {
    const data = buildTimeline(single(payment({ offsetDays: 60 })), today);
    expect(data.endDate).toBe("2027-07-07"); // payment 2027-06-16 plus 21 days
  });

  it("orders same-day payments by label", () => {
    const input = single(payment({ id: "b", label: "B fee", offsetDays: -10 }));
    input.vendors[0].payments.push(payment({ id: "a", label: "A fee", offsetDays: -10 }));
    const labels = buildTimeline(input, today).tasks[1].children!.map((c) => c.name);
    expect(labels).toEqual(["A fee", "B fee"]);
  });

  it("ignores the time of day on the wedding date", () => {
    const input = single(payment({ offsetDays: -7 }));
    input.wedding.date = new Date("2027-04-17T20:30:00Z");
    expect(buildTimeline(input, today).tasks[0].startDate).toBe("2027-04-17");
  });
});

describe("cash needed per month (the Summary footer)", () => {
  it("adds up unpaid payments by the month they fall due, in cents", () => {
    const t = buildTimeline(
      {
        wedding: { coupleNames: "Priya & Sam", date: wedding },
        vendors: [
          vendor([
            payment({ id: "a", offsetDays: -30, amountCents: 100_000 }), // Mar 18
            payment({ id: "b", offsetDays: -20, amountCents: 50_050, status: "due" }), // Mar 28
            payment({ id: "c", offsetDays: 0, amountCents: 70_000 }), // Apr 17
          ]),
        ],
      },
      today,
    );
    expect(t.cashByMonth).toEqual({ "2027-03": 150_050, "2027-04": 70_000 });
  });

  it("leaves out paid, void and refund payments, and cancelled vendors", () => {
    const statuses: PaymentStatus[] = ["paid", "void", "refund_requested", "refunded"];
    const settled = buildTimeline(
      { wedding: { coupleNames: "x", date: wedding }, vendors: [vendor(statuses.map((status, i) => payment({ id: `s${i}`, status })))] },
      today,
    );
    expect(settled.cashByMonth).toEqual({});
    expect(buildTimeline(single(payment(), { status: "cancelled" }), today).cashByMonth).toEqual({});
  });

  it("matches the demo's unpaid total, and moves with the wedding during a what-if", () => {
    const input = demoInput();
    const unpaid = input.vendors.flatMap((v) => v.payments).filter((p) => p.status === "scheduled").reduce((s, p) => s + p.amountCents, 0);
    const base = buildTimeline(input, today);
    const sum = (m: Record<string, number>) => Object.values(m).reduce((s, c) => s + c, 0);
    expect(sum(base.cashByMonth)).toBe(unpaid);

    const later = withBaseline(buildTimeline(demoInput(d("2027-06-17")), today), base);
    expect(sum(later.cashByMonth)).toBe(unpaid);
    expect(later.cashByMonth).not.toEqual(base.cashByMonth);
    // The wedding-day payments now land in June, not April.
    const onTheDay = input.vendors.flatMap((v) => v.payments).filter((p) => p.anchor === "wedding_date" && p.offsetDays === 0);
    if (onTheDay.length) expect(later.cashByMonth["2027-06"]).toBeGreaterThan(0);
  });

  it("agrees with lib/schedule.ts on every due date", () => {
    const input = demoInput();
    const t = buildTimeline(input, today);
    const expected: Record<string, number> = {};
    for (const v of input.vendors)
      for (const p of v.payments) {
        if (p.status !== "scheduled") continue;
        const m = toIsoDate(computeDueDate(p, { weddingDate: wedding, signingDate: v.signingDate })).slice(0, 7);
        expected[m] = (expected[m] ?? 0) + p.amountCents;
      }
    expect(t.cashByMonth).toEqual(expected);
  });
});
