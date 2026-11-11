import type { ProposalSummary } from "@/lib/agent/loop";
import { addDaysUtc, startOfUtcDay, toIsoDate } from "@/lib/schedule";

/**
 * What an agent answer is about, so the timeline can show it: the payments and
 * vendors to highlight, a date range to shade, a wedding date to preview, and a
 * refund to preview. It is worked out here, in code, from the tools the agent
 * ran and what they returned (our own database), never from text the model
 * wrote, so a contract or a prompt can't steer the UI.
 */
export type AgentFocus = {
  /** Vendor rows to highlight and scroll to. Names come from tool output. */
  vendors: { id: string; name: string }[];
  /** Payment milestones to highlight. */
  paymentIds: string[];
  /** A span to shade on the timeline, `YYYY-MM-DD` inclusive. */
  range: { from: string; to: string; label: string } | null;
  /** A wedding date to preview, exactly like dragging the wedding day there. */
  previewDate: string | null;
  /** A refund request waiting for approval: preview the vendor's paid payments as refund requested. */
  refund: { vendorId: string; proposalId: string } | null;
};

/** One tool call of the run, as the loop saw it. */
export type FocusCall = { tool: string; args: Record<string, unknown>; ok: boolean; output: unknown };

const longDay = (isoDate: string) =>
  new Date(`${isoDate}T00:00:00.000Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
const record = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {});
const str = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : null);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const iso = (value: unknown) => {
  const s = str(value);
  return s && ISO.test(s) ? s : null;
};

/**
 * The focus for a finished run, or null when the answer isn't about anything
 * on the timeline. Later calls win for the range and the preview date, so a
 * follow-up tool call refines what the first one found.
 */
export function focusFromRun(calls: FocusCall[], proposals: ProposalSummary[], today: Date): AgentFocus | null {
  const vendors = new Map<string, string>();
  const paymentIds = new Set<string>();
  let range: AgentFocus["range"] = null;
  let previewDate: string | null = null;
  let refund: AgentFocus["refund"] = null;
  const addVendor = (id: unknown, name: unknown) => {
    const vid = str(id);
    const vname = str(name);
    if (vid && vname) vendors.set(vid, vname);
  };

  for (const call of calls) {
    if (!call.ok) continue;
    const out = record(call.output);
    switch (call.tool) {
      case "get_payment_schedule": {
        const payments = Array.isArray(out.payments) ? out.payments.map(record) : [];
        // The whole schedule highlights nothing in particular: only a filtered
        // answer (one vendor, a date range, what's due soon) picks payments out.
        const filtered = ["vendorId", "from", "to", "unpaidDueWithinDays"].some((key) => call.args[key] !== undefined);
        if (filtered) {
          for (const p of payments) {
            const id = str(p.paymentId);
            if (id) paymentIds.add(id);
          }
        }
        // Asked about one vendor: that vendor's row is the subject.
        if (call.args.vendorId !== undefined) for (const p of payments) addVendor(p.vendorId, p.vendorName);
        const days = typeof call.args.unpaidDueWithinDays === "number" ? call.args.unpaidDueWithinDays : null;
        const start = toIsoDate(startOfUtcDay(today));
        if (days !== null && days > 0) {
          range = { from: start, to: toIsoDate(addDaysUtc(startOfUtcDay(today), days)), label: `Due in the next ${days} days` };
        } else if (iso(call.args.from) || iso(call.args.to)) {
          const from = iso(call.args.from) ?? start;
          const to = iso(call.args.to);
          if (to && to >= from) range = { from, to, label: `Due ${longDay(from)} to ${longDay(to)}` };
        }
        break;
      }
      case "compute_refund_owed":
      case "read_clause":
      case "check_payment_status":
        addVendor(out.vendorId, out.vendorName);
        break;
      case "compute_date_change_cost":
        previewDate = iso(out.newDate) ?? previewDate;
        break;
    }
  }

  for (const proposal of proposals) {
    if (proposal.status !== "pending") continue;
    const payload = record(proposal.payload);
    if (proposal.kind === "refund_request" && str(payload.vendorId)) {
      addVendor(payload.vendorId, payload.vendorName);
      refund = { vendorId: str(payload.vendorId)!, proposalId: proposal.id };
    }
    if (proposal.kind === "reschedule") previewDate = iso(payload.newDate) ?? previewDate;
  }

  const focus: AgentFocus = {
    vendors: [...vendors].map(([id, name]) => ({ id, name })),
    paymentIds: [...paymentIds],
    range,
    previewDate,
    refund,
  };
  return isEmptyFocus(focus) ? null : focus;
}

export function isEmptyFocus(focus: AgentFocus): boolean {
  return focus.vendors.length === 0 && focus.paymentIds.length === 0 && !focus.range && !focus.previewDate && !focus.refund;
}

/** A short line for the timeline header: what is being shown. */
export function describeFocus(focus: AgentFocus): string {
  if (focus.previewDate) return `What if the wedding moves to ${longDay(focus.previewDate)}`;
  if (focus.range) return focus.range.label;
  if (focus.vendors.length > 0) return focus.vendors.map((v) => v.name).join(", ");
  return `${focus.paymentIds.length} payment${focus.paymentIds.length === 1 ? "" : "s"} from the answer`;
}
