import { z } from "zod";

/**
 * What `propose_action` stores in `Proposal.payload`, one shape per kind. The
 * tools write these, but the column is untyped JSON, so everything that reads a
 * payload parses it here first instead of trusting its shape.
 */

const reason = z.string().default("");

export const payPayloadSchema = z.object({
  paymentId: z.string(),
  vendorId: z.string(),
  vendorName: z.string(),
  label: z.string(),
  amountCents: z.number().int().nonnegative(),
  dueDate: z.string(),
  reason,
});

export const reschedulePayloadSchema = z.object({
  previousDate: z.string(),
  newDate: z.string(),
  totalCostCents: z.number().int().nonnegative(),
  charges: z
    .array(z.object({ vendorId: z.string(), vendorName: z.string(), costCents: z.number().int().nonnegative(), clauseId: z.string().nullable() }))
    .default([]),
  reason,
});

export const refundPayloadSchema = z.object({
  vendorId: z.string(),
  vendorName: z.string(),
  cancelledBy: z.enum(["couple", "vendor"]),
  cancellationDate: z.string(),
  owedCents: z.number().int().nonnegative(),
  paidCents: z.number().int().nonnegative(),
  calculation: z.string().default(""),
  message: z.string(),
  reason,
});

export const messagePayloadSchema = z.object({ text: z.string(), reason });

export type PayPayload = z.infer<typeof payPayloadSchema>;
export type ReschedulePayload = z.infer<typeof reschedulePayloadSchema>;
export type RefundPayload = z.infer<typeof refundPayloadSchema>;
export type MessagePayload = z.infer<typeof messagePayloadSchema>;

export type ProposalKind = "pay" | "reschedule" | "refund_request" | "message";

export type ParsedPayload =
  | { kind: "pay"; payload: PayPayload }
  | { kind: "reschedule"; payload: ReschedulePayload }
  | { kind: "refund_request"; payload: RefundPayload }
  | { kind: "message"; payload: MessagePayload };

/** The payload for a proposal's kind, or null if it isn't the shape we wrote. */
export function parsePayload(kind: ProposalKind, payload: unknown): ParsedPayload | null {
  switch (kind) {
    case "pay": {
      const r = payPayloadSchema.safeParse(payload);
      return r.success ? { kind, payload: r.data } : null;
    }
    case "reschedule": {
      const r = reschedulePayloadSchema.safeParse(payload);
      return r.success ? { kind, payload: r.data } : null;
    }
    case "refund_request": {
      const r = refundPayloadSchema.safeParse(payload);
      return r.success ? { kind, payload: r.data } : null;
    }
    case "message": {
      const r = messagePayloadSchema.safeParse(payload);
      return r.success ? { kind, payload: r.data } : null;
    }
  }
}
