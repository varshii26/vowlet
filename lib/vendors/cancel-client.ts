import { z } from "zod";

/** Browser side of POST /api/vendors/[id]/cancel. Nothing here throws; every outcome carries a message. */

const previewSchema = z.object({
  ok: z.literal(true),
  vendorName: z.string(),
  cancelledBy: z.enum(["couple", "vendor"]),
  owedCents: z.number().int().nonnegative(),
  paidCents: z.number().int().nonnegative(),
  retainedCents: z.number().int().nonnegative(),
  reason: z.string(),
  clauseId: z.string().nullable(),
  citation: z.string().nullable(),
  clause: z.object({ text: z.string(), page: z.number().int() }).nullable(),
  draft: z.string().nullable(),
});
const confirmSchema = z.object({ ok: z.literal(true), message: z.string(), draft: z.string().nullable(), owedCents: z.number().int().nonnegative() });
const failureSchema = z.object({ ok: z.literal(false), error: z.object({ message: z.string() }) });

export type CancelPreviewView = Omit<z.infer<typeof previewSchema>, "ok">;
export type CancelConfirmView = Omit<z.infer<typeof confirmSchema>, "ok">;
export type CancelledBy = "couple" | "vendor";

const NETWORK = "Couldn't reach Vowlet. Check your connection and try again.";
const UNEXPECTED = "Something unexpected happened. Nothing was changed. Please try again.";

async function post(vendorId: string, body: unknown): Promise<{ json: unknown } | { error: string }> {
  try {
    const res = await fetch(`/api/vendors/${encodeURIComponent(vendorId)}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { json: await res.json().catch(() => null) };
  } catch {
    return { error: NETWORK };
  }
}

const failureMessage = (json: unknown) => {
  const failure = failureSchema.safeParse(json);
  return failure.success ? failure.data.error.message : UNEXPECTED;
};

export async function requestCancelPreview(vendorId: string, cancelledBy: CancelledBy): Promise<{ ok: true; preview: CancelPreviewView } | { ok: false; message: string }> {
  const res = await post(vendorId, { cancelledBy });
  if ("error" in res) return { ok: false, message: res.error };
  const parsed = previewSchema.safeParse(res.json);
  if (!parsed.success) return { ok: false, message: failureMessage(res.json) };
  const { ok: _ok, ...preview } = parsed.data; // eslint-disable-line @typescript-eslint/no-unused-vars
  return { ok: true, preview };
}

export async function requestCancelConfirm(vendorId: string, cancelledBy: CancelledBy): Promise<{ ok: true; result: CancelConfirmView } | { ok: false; message: string }> {
  const res = await post(vendorId, { cancelledBy, confirm: true });
  if ("error" in res) return { ok: false, message: res.error };
  const parsed = confirmSchema.safeParse(res.json);
  if (!parsed.success) return { ok: false, message: failureMessage(res.json) };
  const { ok: _ok, ...result } = parsed.data; // eslint-disable-line @typescript-eslint/no-unused-vars
  return { ok: true, result };
}
