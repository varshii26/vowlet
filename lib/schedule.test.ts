import { describe, expect, it } from "vitest";
import {
  DUE_SOON_DAYS,
  addDaysUtc,
  computeDueDate,
  daysBetweenUtc,
  getDisplayStatus,
  startOfUtcDay,
  toIsoDate,
  type ScheduleAnchors,
} from "@/lib/schedule";
import { VENDORS, WEDDING } from "@/lib/seed/demo-data";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);

const anchors: ScheduleAnchors = { weddingDate: d("2027-04-17"), signingDate: d("2026-06-12") };

describe("date helpers", () => {
  it("startOfUtcDay drops the time of day", () => {
    expect(startOfUtcDay(new Date("2027-04-17T23:59:59.999Z")).toISOString()).toBe("2027-04-17T00:00:00.000Z");
    expect(startOfUtcDay(new Date("2027-04-17T00:00:00.000Z")).toISOString()).toBe("2027-04-17T00:00:00.000Z");
  });

  it("addDaysUtc crosses month and year boundaries both ways", () => {
    expect(iso(addDaysUtc(d("2027-01-31"), 1))).toBe("2027-02-01");
    expect(iso(addDaysUtc(d("2027-01-01"), -1))).toBe("2026-12-31");
    expect(iso(addDaysUtc(d("2026-12-31"), 1))).toBe("2027-01-01");
    expect(iso(addDaysUtc(d("2027-04-17"), 0))).toBe("2027-04-17");
  });

  it("addDaysUtc handles leap years", () => {
    expect(iso(addDaysUtc(d("2028-03-01"), -1))).toBe("2028-02-29");
    expect(iso(addDaysUtc(d("2027-03-01"), -1))).toBe("2027-02-28");
    expect(iso(addDaysUtc(d("2028-02-28"), 2))).toBe("2028-03-01");
  });

  it("addDaysUtc is unaffected by daylight-saving changes", () => {
    // US clocks change on 2027-03-14 and 2027-11-07; UTC days must not move.
    expect(iso(addDaysUtc(d("2027-03-20"), -7))).toBe("2027-03-13");
    expect(iso(addDaysUtc(d("2027-03-13"), 2))).toBe("2027-03-15");
    expect(iso(addDaysUtc(d("2027-11-06"), 2))).toBe("2027-11-08");
  });

  it("addDaysUtc normalises the input to a day and rejects bad input", () => {
    expect(addDaysUtc(new Date("2027-04-17T18:30:00Z"), 1).toISOString()).toBe("2027-04-18T00:00:00.000Z");
    expect(() => addDaysUtc(d("2027-04-17"), 1.5)).toThrow(RangeError);
    expect(() => addDaysUtc(new Date("nope"), 1)).toThrow(RangeError);
  });

  it("daysBetweenUtc counts calendar days, ignoring time", () => {
    expect(daysBetweenUtc(d("2027-04-10"), d("2027-04-17"))).toBe(7);
    expect(daysBetweenUtc(d("2027-04-17"), d("2027-04-10"))).toBe(-7);
    expect(daysBetweenUtc(new Date("2027-04-10T23:00:00Z"), new Date("2027-04-11T01:00:00Z"))).toBe(1);
    expect(daysBetweenUtc(d("2028-02-28"), d("2028-03-01"))).toBe(2);
  });

  it("toIsoDate formats a UTC day", () => {
    expect(toIsoDate(new Date("2027-04-17T23:00:00Z"))).toBe("2027-04-17");
  });
});

describe("computeDueDate", () => {
  it("anchors to the wedding date with negative and positive offsets", () => {
    expect(iso(computeDueDate({ anchor: "wedding_date", offsetDays: -30 }, anchors))).toBe("2027-03-18");
    expect(iso(computeDueDate({ anchor: "wedding_date", offsetDays: 14 }, anchors))).toBe("2027-05-01");
    expect(iso(computeDueDate({ anchor: "wedding_date", offsetDays: 0 }, anchors))).toBe("2027-04-17");
  });

  it("anchors to the vendor's signing date", () => {
    expect(iso(computeDueDate({ anchor: "signing_date", offsetDays: 0 }, anchors))).toBe("2026-06-12");
    expect(iso(computeDueDate({ anchor: "signing_date", offsetDays: 10 }, anchors))).toBe("2026-06-22");
  });

  it("anchors to a fixed date and ignores the wedding and signing dates", () => {
    const payment = { anchor: "fixed" as const, offsetDays: 0, fixedDate: d("2026-12-01") };
    expect(iso(computeDueDate(payment, anchors))).toBe("2026-12-01");
    expect(iso(computeDueDate(payment, { ...anchors, weddingDate: d("2028-01-01") }))).toBe("2026-12-01");
  });

  it("throws for a fixed payment with no fixed date", () => {
    expect(() => computeDueDate({ anchor: "fixed", offsetDays: 0 }, anchors)).toThrow(/fixedDate/);
    expect(() => computeDueDate({ anchor: "fixed", offsetDays: 0, fixedDate: null }, anchors)).toThrow(/fixedDate/);
  });

  it("ignores a stray fixedDate on non-fixed payments", () => {
    const payment = { anchor: "wedding_date" as const, offsetDays: -1, fixedDate: d("2020-01-01") };
    expect(iso(computeDueDate(payment, anchors))).toBe("2027-04-16");
  });

  it("returns midnight UTC even when the wedding date carries a time", () => {
    const withTime = { ...anchors, weddingDate: new Date("2027-04-17T20:45:00Z") };
    expect(computeDueDate({ anchor: "wedding_date", offsetDays: -7 }, withTime).toISOString()).toBe(
      "2027-04-10T00:00:00.000Z",
    );
  });

  it("handles a wedding date in a leap year", () => {
    const leap = { ...anchors, weddingDate: d("2028-03-01") };
    expect(iso(computeDueDate({ anchor: "wedding_date", offsetDays: -1 }, leap))).toBe("2028-02-29");
  });
});

describe("reflow when the wedding date moves", () => {
  const dueDates = (weddingDate: Date) =>
    VENDORS.flatMap((vendor) =>
      vendor.payments.map((p) => ({
        key: `${vendor.slug}/${p.label}`,
        anchor: p.anchor,
        due: computeDueDate(
          {
            anchor: p.anchor,
            offsetDays: p.offsetDays ?? 0,
            fixedDate: p.fixedDate ? d(p.fixedDate) : null,
          },
          { weddingDate, signingDate: d(vendor.signingDate) },
        ),
      })),
    );

  it("shifts every wedding-anchored payment by the same number of days and nothing else", () => {
    const original = dueDates(d(WEDDING.date));
    const postponed = dueDates(d("2027-06-17")); // two months later, 61 days
    const shift = daysBetweenUtc(d(WEDDING.date), d("2027-06-17"));
    expect(shift).toBe(61);

    expect(original).toHaveLength(23);
    for (let i = 0; i < original.length; i++) {
      const moved = daysBetweenUtc(original[i].due, postponed[i].due);
      expect(moved, original[i].key).toBe(original[i].anchor === "wedding_date" ? shift : 0);
    }
  });
});

describe("getDisplayStatus", () => {
  const today = d("2026-11-06");

  it("lets settled states win over timing", () => {
    const longAgo = d("2020-01-01");
    for (const status of ["paid", "refund_requested", "refunded", "void"] as const) {
      expect(getDisplayStatus(status, longAgo, today)).toBe(status);
    }
  });

  it("marks a payment due before today as overdue", () => {
    expect(getDisplayStatus("scheduled", d("2026-11-05"), today)).toBe("overdue");
    expect(getDisplayStatus("due", d("2026-01-01"), today)).toBe("overdue");
  });

  it("treats due today as due soon, not overdue", () => {
    expect(getDisplayStatus("scheduled", d("2026-11-06"), today)).toBe("due_soon");
  });

  it("uses an inclusive due-soon window", () => {
    expect(DUE_SOON_DAYS).toBe(14);
    expect(getDisplayStatus("scheduled", d("2026-11-20"), today)).toBe("due_soon"); // exactly 14 days
    expect(getDisplayStatus("scheduled", d("2026-11-21"), today)).toBe("scheduled"); // 15 days
  });

  it("accepts a custom window", () => {
    expect(getDisplayStatus("scheduled", d("2026-11-09"), today, 3)).toBe("due_soon");
    expect(getDisplayStatus("scheduled", d("2026-11-10"), today, 3)).toBe("scheduled");
  });

  it("ignores the time of day on today", () => {
    const lateToday = new Date("2026-11-06T23:59:00Z");
    expect(getDisplayStatus("scheduled", d("2026-11-06"), lateToday)).toBe("due_soon");
    expect(getDisplayStatus("scheduled", d("2026-11-05"), lateToday)).toBe("overdue");
  });
});
