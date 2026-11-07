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
  basis: z.string(),
  clauseId: z.string().nullable(),
  citation: z.string().nullable(),
  clause: z.object({ text: z.string(), page: z.number().int() }).nullable(),
});

const previewSchema = z.object({
  ok: z.literal(true),
  currentDate: z.string(),
  newDate: z.string(),
  shiftDays: z.number().int(),
  noticeDays: z.number().int().nonnegative(),
  totalCents: z.number().int().nonnegative(),
  rows: z.array(rowSchema),
});
const applySchema = z.object({ ok: z.literal(true), message: z.string() });
const explainSchema = z.object({ ok: z.literal(true), newDate: z.string(), text: z.string().min(1), source: z.enum(["model", "template"]) });
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
  const { currentDate, newDate: date, shiftDays, noticeDays, totalCents, rows } = parsed.data;
  return { ok: true, preview: { currentDate, newDate: date, shiftDays, noticeDays, totalCents, rows } };
}

export async function requestApply(newDate: string, previousDate: string): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const res = await postJson("/api/whatif/apply", { newDate, previousDate });
  if ("error" in res) return { ok: false, message: res.error };
  const parsed = applySchema.safeParse(res.json);
  return parsed.success ? { ok: true, message: parsed.data.message } : { ok: false, message: failureMessage(res.json) };
}

/** The short written summary of a what-if. Optional extra: a failure just means no summary is shown. */
export async function requestExplanation(newDate: string): Promise<{ ok: true; text: string; source: "model" | "template" } | { ok: false; message: string }> {
  const res = await postJson("/api/whatif/explain", { newDate });
  if ("error" in res) return { ok: false, message: res.error };
  const parsed = explainSchema.safeParse(res.json);
  return parsed.success ? { ok: true, text: parsed.data.text, source: parsed.data.source } : { ok: false, message: failureMessage(res.json) };
}
