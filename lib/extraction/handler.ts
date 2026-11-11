import { extractContract } from "@/lib/extraction/extract";
import type { GeminiClient } from "@/lib/llm/gemini";
import { extractPdfPages } from "@/lib/pdf-text";
import type { RateLimiter } from "@/lib/rate-limit";

/** Gemini accepts up to 20 MB inline; contracts are a few pages. */
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

export type ExtractHandlerDeps = {
  client: GeminiClient;
  models: string[];
  limiter: RateLimiter;
  /** Who is asking (the user id), so the limit is per person rather than one bucket for everyone. */
  limitKey?: string;
  /** False when GEMINI_API_KEY is not set. */
  configured: boolean;
};

const fail = (status: number, code: string, message: string, headers?: HeadersInit) =>
  Response.json({ ok: false, error: { code, message } }, { status, headers });

const isPdf = (bytes: Uint8Array) => bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";

/**
 * POST /api/contracts/extract: multipart form with one PDF in `file`.
 *
 * The model reads the contract, and everything it says is then checked in code:
 * the schema, the amounts and dates, and that every quote really appears in the
 * PDF. Terms the model was unsure of, or could not quote, come back with
 * `needsReview: true` for the user to confirm. Nothing is saved here.
 */
export async function extractHandler(request: Request, deps: ExtractHandlerDeps): Promise<Response> {
  if (!deps.configured) {
    return fail(503, "not_configured", "AI extraction isn't set up on this server yet.");
  }

  // Each extraction spends free-tier quota, and this endpoint is public.
  const limit = deps.limiter.check(deps.limitKey);
  if (!limit.allowed) {
    const seconds = Math.ceil(limit.retryAfterMs / 1000);
    return fail(429, "too_many_requests", `Too many extractions right now. Try again in ${seconds} seconds.`, {
      "Retry-After": String(seconds),
    });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "bad_request", "Send the contract as a form upload with a PDF in the 'file' field.");
  }

  const file = form.get("file");
  if (!(file instanceof File)) return fail(400, "bad_request", "No PDF was uploaded. Use the 'file' field.");
  if (file.size === 0) return fail(400, "bad_request", "That file is empty.");
  if (file.size > MAX_PDF_BYTES) return fail(413, "too_large", "That PDF is larger than 10 MB.");

  const pdf = new Uint8Array(await file.arrayBuffer());
  // Check the bytes, not the file name or the type the browser claims.
  if (!isPdf(pdf)) return fail(400, "not_a_pdf", "That file isn't a PDF.");

  let pages: string[];
  try {
    pages = await extractPdfPages(pdf);
  } catch {
    return fail(400, "unreadable_pdf", "That PDF couldn't be read. It may be damaged or password protected.");
  }
  if (pages.every((page) => page.trim() === "")) {
    return fail(422, "no_text", "That PDF has no selectable text (it may be a scan), so its clauses can't be verified.");
  }

  const outcome = await extractContract({ client: deps.client, models: deps.models, pdf, pages });
  if (!outcome.ok) {
    return fail(502, "extraction_failed", `The contract couldn't be read reliably: ${outcome.errors.slice(0, 3).join("; ")}`);
  }
  return Response.json({
    ok: true,
    terms: outcome.terms,
    model: outcome.model,
    attempts: outcome.attempts,
    usage: outcome.usage,
    ms: outcome.ms,
  });
}
