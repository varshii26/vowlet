import { z } from "zod";

/**
 * Browser side of POST /api/whatif and /api/whatif/apply. Nothing here throws;
 * every outcome carries a message the couple can read.
 */

const rowSchema = z.object({
  vendorId: z.string(),
  kind: z.enum(["fee", "free", "check", "cancelled"]),
  vendorName: z.string(),
  costCents: z.number().int().nonnegative(),
  reason: z.string(),
  clauseId: z.string().nullable(),
  citation: z.string().nullable(),
});

const previewSchema = z.object({
  ok: z.literal(true),
  currentDate: z.string(),
  newDate: z.string(),
  shiftDays: z.number().int(),
  totalCents: z.number().int().nonnegative(),
  rows: z.array(rowSchema),
});
const applySchema = z.object({ ok: z.literal(true), message: z.string() });
const failureSchema = z.object({ ok: z.literal(false), error: z.object({ message: z.string() }) });

export type WhatIfRowView = z.infer<typeof rowSchema>;
export type WhatIfPreviewView = Omit<z.infer<typeof previewSchema>, "ok">;

const NETWORK = "Couldn't reach Vowlet. Check your connection and try again.";
const UNEXPECTED = "Something unexpected happened. Nothing was changed. Please try again.";

async function postJson(url: string, body: unknown): Promise<{ json: unknown } | { error: string }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { json: await res.json().catch(() => null) };
  } catch {
    return { error: NETWORK };
  }
}

const failureMessage = (json: unknown) => {
  const failure = failureSchema.safeParse(json);
  return failure.success ? failure.data.error.message : UNEXPECTED;
};

export async function requestWhatIf(newDate: string): Promise<{ ok: true; preview: WhatIfPreviewView } | { ok: false; message: string }> {
  const res = await postJson("/api/whatif", { newDate });
  if ("error" in res) return { ok: false, message: res.error };
  const parsed = previewSchema.safeParse(res.json);
  if (!parsed.success) return { ok: false, message: failureMessage(res.json) };
  const { currentDate, newDate: date, shiftDays, totalCents, rows } = parsed.data;
  return { ok: true, preview: { currentDate, newDate: date, shiftDays, totalCents, rows } };
}

export async function requestApply(newDate: string, previousDate: string): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const res = await postJson("/api/whatif/apply", { newDate, previousDate });
  if ("error" in res) return { ok: false, message: res.error };
  const parsed = applySchema.safeParse(res.json);
  return parsed.success ? { ok: true, message: parsed.data.message } : { ok: false, message: failureMessage(res.json) };
}
