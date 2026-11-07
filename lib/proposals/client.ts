import { z } from "zod";
import type { ResolveAction } from "@/lib/proposals/service";

/**
 * Browser side of POST /api/proposals/[id]: what the Approve and Dismiss buttons
 * call. Nothing here throws; every outcome has a message the couple can read.
 */

const failureSchema = z.object({ ok: z.literal(false), error: z.object({ message: z.string() }) });
const successSchema = z.object({
  ok: z.literal(true),
  status: z.enum(["approved", "dismissed"]),
  message: z.string(),
  draft: z.string().optional(),
  alreadyResolved: z.boolean().optional(),
});

export type ResolveOutcome =
  | { ok: true; status: "approved" | "dismissed"; message: string; draft?: string }
  | { ok: false; message: string };

const NETWORK = "Couldn't reach Vowlet. Check your connection and try again.";
const UNEXPECTED = "Something unexpected happened. Nothing was changed. Please try again.";

export async function requestResolve(proposalId: string, action: ResolveAction): Promise<ResolveOutcome> {
  let json: unknown;
  try {
    const res = await fetch(`/api/proposals/${encodeURIComponent(proposalId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    json = await res.json().catch(() => null);
  } catch {
    return { ok: false, message: NETWORK };
  }

  const success = successSchema.safeParse(json);
  if (success.success) {
    const { status, message, draft } = success.data;
    return { ok: true, status, message, ...(draft ? { draft } : {}) };
  }
  const failure = failureSchema.safeParse(json);
  return { ok: false, message: failure.success ? failure.data.error.message : UNEXPECTED };
}
