import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { confirmCancellation, previewCancellation } from "@/lib/vendors/cancel";

const HELP = 'Send a JSON body like { "cancelledBy": "vendor" } to preview, or { "cancelledBy": "vendor", "confirm": true } to cancel.';
const bodySchema = z.object({ cancelledBy: z.enum(["couple", "vendor"]), confirm: z.boolean().optional() });

const fail = (status: number, code: string, message: string) => Response.json({ ok: false, error: { code, message } }, { status });

/**
 * POST /api/vendors/[id]/cancel `{ cancelledBy, confirm? }`.
 * Without `confirm`: what is owed back and the drafted request. Changes nothing.
 * With `confirm: true` (only the CancelModal's Confirm button sends it): marks the
 * vendor cancelled and its paid payments refund requested. Nothing is sent and no
 * refund is issued; the drafted request comes back for the couple to copy.
 */
export async function cancelVendorHandler(vendorId: string, request: Request, deps: { prisma: PrismaClient; resolveWeddingId: () => Promise<string | null>; now?: () => Date }): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail(400, "bad_request", HELP);
  }
  const body = bodySchema.safeParse(raw);
  if (!body.success) return fail(400, "bad_request", HELP);

  const weddingId = await deps.resolveWeddingId();
  if (!weddingId) return fail(404, "not_found", "That vendor doesn't exist.");
  const now = deps.now?.() ?? new Date();
  const result = body.data.confirm
    ? await confirmCancellation(deps.prisma, weddingId, vendorId, body.data.cancelledBy, now)
    : await previewCancellation(deps.prisma, weddingId, vendorId, body.data.cancelledBy, now);
  if (!result.ok) return fail(result.status, result.code, result.message);
  return Response.json(result);
}
