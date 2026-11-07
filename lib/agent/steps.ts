import type { ToolOutcome } from "@/lib/agent/tools";

/** One line in the live "what the assistant is doing" list. */
export type AgentStep = { tool: string; ok: boolean; label: string };

const KIND_WORDS: Record<string, string> = {
  payment: "payment",
  cancellation: "cancellation",
  date_change: "date-change",
  other: "contract",
};

/** Reads a field from a tool's output, which is JSON of unknown shape. */
function field(output: unknown, key: string): unknown {
  return typeof output === "object" && output !== null ? (output as Record<string, unknown>)[key] : undefined;
}
const text = (value: unknown) => (typeof value === "string" ? value : undefined);

/**
 * The progress line for a finished tool call. Labels are built from the tool's
 * own output, which comes from our database, and never from text the model
 * wrote, so nothing in a contract or a prompt can reach the live step list.
 */
export function describeStep(tool: string, args: Record<string, unknown>, outcome: ToolOutcome): AgentStep {
  if (!outcome.ok) return { tool, ok: false, label: "Adjusting a request that didn't work…" };
  const out = outcome.output;

  switch (tool) {
    case "get_wedding":
      return { tool, ok: true, label: "Checking the wedding date and budget…" };

    case "get_vendors":
      return { tool, ok: true, label: "Looking up your vendors…" };

    case "get_payment_schedule": {
      const payments = field(out, "payments");
      const vendor = Array.isArray(payments) ? text(field(payments[0], "vendorName")) : undefined;
      const label =
        args.vendorId !== undefined && vendor
          ? `Reading the payment schedule for ${vendor}…`
          : args.unpaidDueWithinDays !== undefined
            ? "Checking what is due soon…"
            : "Reading the payment schedule…";
      return { tool, ok: true, label };
    }

    case "check_payment_status": {
      const vendor = text(field(out, "vendorName"));
      return { tool, ok: true, label: vendor ? `Checking ${vendor}'s payments with PayPal…` : "Checking payments with PayPal…" };
    }

    case "read_clause": {
      const vendor = text(field(out, "vendorName"));
      const kind = KIND_WORDS[text(field(out, "kind")) ?? ""] ?? "contract";
      return { tool, ok: true, label: vendor ? `Reading ${vendor}'s ${kind} clause…` : `Reading a ${kind} clause…` };
    }

    case "compute_date_change_cost": {
      const rows = field(out, "rows");
      const count = Array.isArray(rows) ? rows.length : 0;
      const date = text(field(out, "newDate"));
      return { tool, ok: true, label: `Calculating date-change fees for ${count} vendors${date ? `, moving to ${date}` : ""}…` };
    }

    case "compute_refund_owed": {
      const vendor = text(field(out, "vendorName"));
      return { tool, ok: true, label: vendor ? `Working out what ${vendor} owes back…` : "Working out what is owed back…" };
    }

    case "propose_action": {
      const kind = text(field(out, "kind"));
      const label =
        kind === "reschedule"
          ? "Preparing a reschedule proposal for you to review…"
          : kind === "refund_request"
            ? "Drafting a refund request for you to review…"
            : kind === "pay"
              ? "Preparing a payment proposal for you to review…"
              : "Preparing a note for you…";
      return { tool, ok: true, label };
    }

    default:
      return { tool, ok: true, label: "Working…" };
  }
}
