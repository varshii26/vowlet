import { describe, expect, it } from "vitest";
import type { AgentFocus } from "@/lib/agent/focus";
import { applyFocus } from "@/lib/timeline-focus";
import { STATUS_COLOR, WEDDING_TASK_ID, buildTimeline, paymentTaskId, vendorTaskId, type TimelineInput, type TimelinePayment } from "@/lib/timeline";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const today = d("2026-11-11");

const pay = (id: string, over: Partial<TimelinePayment> = {}): TimelinePayment => ({
  id,
  label: id,
  amountCents: 100_000,
  anchor: "wedding_date",
  offsetDays: -30,
  fixedDate: null,
  status: "scheduled",
  clause: null,
  ...over,
});

const input: TimelineInput = {
  wedding: { coupleNames: "Priya & Sam", date: d("2027-04-17") },
  vendors: [
    { id: "florist", name: "Bloom & Thistle Florals", status: "active", signingDate: d("2026-07-01"), payments: [pay("f1", { anchor: "signing_date", offsetDays: 0, status: "paid" }), pay("f2")] },
    { id: "dj", name: "DJ Marlow Sound", status: "active", signingDate: d("2026-09-01"), payments: [pay("d1", { anchor: "fixed", offsetDays: 0, fixedDate: d("2026-12-01") }), pay("d2")] },
  ],
};
const base = buildTimeline(input, today);
const none: AgentFocus = { vendors: [], paymentIds: [], range: null, previewDate: null, refund: null };
const find = (data: { tasks: { id: string; children?: { id: string }[] }[] }, id: string) =>
  data.tasks.flatMap((t) => [t, ...(t.children ?? [])]).find((t) => t.id === id) as unknown as { cls: string; eventColor: string; expanded?: boolean };

describe("applyFocus", () => {
  it("changes nothing without a focus", () => {
    const out = applyFocus(base, null, new Set());
    expect(out.tasks).toBe(base.tasks);
    expect(out.timeRanges).toEqual([]);
    expect(out.focusTaskId).toBeNull();
  });

  it("'next 30 days': highlights the payments due, dims the rest, shades the range and scrolls to the first", () => {
    const out = applyFocus(base, { ...none, paymentIds: ["d1"], range: { from: "2026-11-11", to: "2026-12-11", label: "Due in the next 30 days" } }, new Set());
    expect(find(out, paymentTaskId("d1")).cls).toContain("vw-focus");
    expect(find(out, paymentTaskId("d2")).cls).toContain("vw-dim");
    expect(find(out, vendorTaskId("dj")).cls).toContain("vw-focus");
    expect(find(out, vendorTaskId("florist")).cls).toContain("vw-dim");
    expect(find(out, vendorTaskId("dj")).expanded).toBe(false); // payments roll up; the row stays compact
    expect(find(out, WEDDING_TASK_ID).cls).toBe("wedding");
    expect(out.timeRanges).toEqual([
      { id: "agent-range", name: "Due in the next 30 days", startDate: "2026-11-11", endDate: "2026-12-12", cls: "vw-focus-range" },
    ]);
    expect(out.focusTaskId).toBe(vendorTaskId("dj"));
  });

  it("'the florist cancelled': opens and highlights the florist, previews paid payments as refund requested while the proposal waits", () => {
    const focus: AgentFocus = { ...none, vendors: [{ id: "florist", name: "Bloom & Thistle Florals" }], refund: { vendorId: "florist", proposalId: "prop-1" } };
    const out = applyFocus(base, focus, new Set(["prop-1"]));
    const florist = find(out, vendorTaskId("florist"));
    expect(florist.cls).toContain("vw-focus");
    expect(florist.expanded).toBe(true);
    expect(out.focusTaskId).toBe(vendorTaskId("florist"));

    const deposit = find(out, paymentTaskId("f1"));
    expect(deposit.eventColor).toBe(STATUS_COLOR.refund_requested);
    expect(deposit.cls).toContain("payment-refund_requested");
    expect(deposit.cls).toContain("vw-preview");
    expect(out.details[paymentTaskId("f1")]).toMatchObject({ status: "refund_requested", statusLabel: "Refund requested (if you approve)" });
    // The unpaid balance has nothing to refund.
    expect(find(out, paymentTaskId("f2")).eventColor).toBe(STATUS_COLOR.scheduled);
    // The base data is left alone.
    expect(base.details[paymentTaskId("f1")]).toMatchObject({ status: "paid" });
  });

  it("drops the refund preview once the proposal is approved or dismissed", () => {
    const focus: AgentFocus = { ...none, vendors: [{ id: "florist", name: "Bloom & Thistle Florals" }], refund: { vendorId: "florist", proposalId: "prop-1" } };
    const out = applyFocus(base, focus, new Set());
    expect(find(out, paymentTaskId("f1")).eventColor).toBe(STATUS_COLOR.paid);
    expect(find(out, vendorTaskId("florist")).cls).toContain("vw-focus"); // still the subject of the answer
  });

  it("ignores ids that aren't on the timeline", () => {
    const out = applyFocus(base, { ...none, vendors: [{ id: "gone", name: "Gone" }] }, new Set());
    expect(out.focusTaskId).toBeNull();
  });
});
