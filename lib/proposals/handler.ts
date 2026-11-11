import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { resolveProposal } from "@/lib/proposals/service";

const ACTION_HELP = 'action must be "approve" or "dismiss".';
// The same plain message for every malformed shape: a missing field, a wrong value, or a body that isn't an object.
const bodySchema = z.object({ action: z.enum(["approve", "dismiss"], { error: ACTION_HELP }) }, { error: ACTION_HELP });

const fail = (status: number, code: string, message: string) => Response.json({ ok: false, error: { code, message } }, { status });

/**
 * POST /api/proposals/[id] with `{ "action": "approve" | "dismiss" }`.
 * A human clicking a button is the only thing that calls this. Approving never
 * pays: a pay proposal is only approved once the payment has gone through PayPal.
 */
export async function proposalHandler(proposalId: string, request: Request, deps: { prisma: PrismaClient; resolveWeddingId: () => Promise<string | null>; now?: () => Date }): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail(400, "bad_request", 'Send a JSON body like { "action": "approve" }.');
  }
  const body = bodySchema.safeParse(raw);
  if (!body.success) return fail(400, "bad_request", body.error.issues[0]?.message ?? 'action must be "approve" or "dismiss".');

  const weddingId = await deps.resolveWeddingId();
  if (!weddingId) return fail(404, "not_found", "That proposal doesn't exist.");
  const result = await resolveProposal(deps.prisma, weddingId, proposalId, body.data.action, deps.now?.());
  if (!result.ok) return fail(result.status, result.code, result.message);
  return Response.json({
    ok: true,
    status: result.status,
    message: result.message,
    ...(result.draft ? { draft: result.draft } : {}),
    ...(result.alreadyResolved ? { alreadyResolved: true } : {}),
  });
}
