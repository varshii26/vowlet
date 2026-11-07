import { z } from "zod";
import { cancellationRulesSchema, dateChangeRulesSchema } from "@/lib/rules";
import type { ReviewedContract } from "@/lib/upload/schema";

/**
 * Browser side of POST /api/contracts/extract and /api/contracts/confirm.
 * Nothing here throws; every outcome carries a message the couple can read.
 * Server responses are validated before the page uses them.
 */

const evidence = {
  clauseQuote: z.string(),
  page: z.number().int(),
  confidence: z.number(),
  quoteVerified: z.boolean(),
  needsReview: z.boolean(),
};

const cents = z.number().int().nonnegative();

const termsSchema = z.object({
  vendorName: z.string(),
  category: z.string(),
  totalCents: cents,
  payments: z.array(
    z.object({
      label: z.string(),
      amountCents: cents,
      anchor: z.enum(["wedding_date", "signing_date", "fixed"]),
      offsetDays: z.number().int(),
      fixedDate: z.string().nullable(),
      ...evidence,
    }),
  ),
  cancellation: z.object({ found: z.boolean(), rules: cancellationRulesSchema, ...evidence }),
  dateChange: z.object({ found: z.boolean(), rules: dateChangeRulesSchema, ...evidence }),
});

const extractSchema = z.object({ ok: z.literal(true), terms: termsSchema });
const confirmSchema = z.object({ ok: z.literal(true), vendorId: z.string(), vendorName: z.string(), message: z.string() });
const failureSchema = z.object({ ok: z.literal(false), error: z.object({ message: z.string() }) });

export type ExtractedTermsView = z.infer<typeof termsSchema>;

const NETWORK = "Couldn't reach Vowlet. Check your connection and try again.";
const UNEXPECTED = "Something unexpected happened. Please try again.";

async function postForm(url: string, form: FormData): Promise<{ json: unknown } | { error: string }> {
  try {
    const res = await fetch(url, { method: "POST", body: form });
    return { json: await res.json().catch(() => null) };
  } catch {
    return { error: NETWORK };
  }
}

const failureMessage = (json: unknown) => {
  const failure = failureSchema.safeParse(json);
  return failure.success ? failure.data.error.message : UNEXPECTED;
};

export async function requestExtraction(file: File): Promise<{ ok: true; terms: ExtractedTermsView } | { ok: false; message: string }> {
  const form = new FormData();
  form.set("file", file);
  const res = await postForm("/api/contracts/extract", form);
  if ("error" in res) return { ok: false, message: res.error };
  const parsed = extractSchema.safeParse(res.json);
  return parsed.success ? { ok: true, terms: parsed.data.terms } : { ok: false, message: failureMessage(res.json) };
}

export async function requestConfirm(
  file: File,
  review: ReviewedContract,
): Promise<{ ok: true; vendorId: string; vendorName: string; message: string } | { ok: false; message: string }> {
  const form = new FormData();
  form.set("file", file);
  form.set("review", JSON.stringify(review));
  const res = await postForm("/api/contracts/confirm", form);
  if ("error" in res) return { ok: false, message: res.error };
  const parsed = confirmSchema.safeParse(res.json);
  if (!parsed.success) return { ok: false, message: failureMessage(res.json) };
  const { vendorId, vendorName, message } = parsed.data;
  return { ok: true, vendorId, vendorName, message };
}
