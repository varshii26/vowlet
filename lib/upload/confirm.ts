import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@/generated/prisma/client";
import { extractPdfPages } from "@/lib/pdf-text";
import { verifyQuote } from "@/lib/quotes";
import type { RateLimiter } from "@/lib/rate-limit";
import { parseVendorEmails, vendorEmail } from "@/lib/seed/vendor-emails";
import { reviewedContractSchema, unacknowledged, type ReviewedContract } from "@/lib/upload/schema";

/** Same limit as extraction: contracts are a few pages. */
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

/** Where confirmed uploads are stored, relative to the app root. Seeded contracts stay in seed/contracts/. */
export const UPLOADS_DIR = "data/uploads";

/** `data/uploads/<vendorId>.pdf`, the value stored in `Vendor.contractPath`. */
export const uploadedContractPath = (vendorId: string) => `${UPLOADS_DIR}/${vendorId}.pdf`;

export type ConfirmDeps = {
  prisma: PrismaClient;
  limiter: RateLimiter;
  /** The wedding the signed-in caller is working on, from their session; null if they have none yet. */
  resolveWeddingId: () => Promise<string | null>;
  /** The app root that `contractPath` is relative to. Defaults to the working directory. */
  rootDir?: string;
  /** Sandbox payee emails for vendors uploaded without one (PAYPAL_VENDOR_EMAILS). */
  vendorEmails?: string;
};

const fail = (status: number, code: string, message: string, headers?: HeadersInit) =>
  Response.json({ ok: false, error: { code, message } }, { status, headers });

const isPdf = (bytes: Uint8Array) => bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * Re-check every quote against the PDF. A quote that isn't in the document is
 * flagged whatever the browser says, so it can only be saved once the couple
 * has acknowledged it. Verified quotes take the page they were found on.
 */
function recheck(contract: ReviewedContract, pages: readonly string[]): ReviewedContract {
  const check = <T extends { clauseQuote: string; page: number; flagged: boolean }>(item: T): T => {
    const result = verifyQuote(pages, item.clauseQuote);
    return result.verified ? { ...item, page: result.page } : { ...item, flagged: true };
  };
  return {
    ...contract,
    payments: contract.payments.map(check),
    cancellation: contract.cancellation.found ? check(contract.cancellation) : contract.cancellation,
    dateChange: contract.dateChange.found ? check(contract.dateChange) : contract.dateChange,
  };
}

/**
 * POST /api/contracts/confirm: multipart form with the PDF in `file` and the
 * reviewed terms as JSON in `review`. Writes the Vendor, its Clauses, Payments
 * and Terms in one transaction, and stores the PDF at
 * `data/uploads/<vendorId>.pdf`. The path is chosen here, never by the browser.
 */
export async function confirmHandler(request: Request, deps: ConfirmDeps): Promise<Response> {
  // The vendor goes into the signed-in couple's own wedding, never "the first one"; the limit is theirs too.
  const weddingId = await deps.resolveWeddingId();
  const limit = deps.limiter.check(weddingId ?? undefined);
  if (!limit.allowed) {
    const seconds = Math.max(1, Math.ceil(limit.retryAfterMs / 1000));
    return fail(429, "too_many_requests", `Too many contracts saved at once. Try again in ${seconds} seconds.`, { "Retry-After": String(seconds) });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "bad_request", "Send a form upload with the PDF in 'file' and the reviewed terms in 'review'.");
  }

  const file = form.get("file");
  if (!(file instanceof File)) return fail(400, "bad_request", "No PDF was uploaded. Use the 'file' field.");
  if (file.size === 0) return fail(400, "bad_request", "That file is empty.");
  if (file.size > MAX_PDF_BYTES) return fail(413, "too_large", "That PDF is larger than 10 MB.");
  const pdf = new Uint8Array(await file.arrayBuffer());
  if (!isPdf(pdf)) return fail(400, "not_a_pdf", "That file isn't a PDF.");

  const raw = form.get("review");
  let json: unknown;
  try {
    json = typeof raw === "string" ? JSON.parse(raw) : undefined;
  } catch {
    json = undefined;
  }
  const parsed = reviewedContractSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "review"}: ${i.message}`);
    return fail(400, "invalid_review", `The reviewed terms aren't valid: ${issues.join("; ")}`);
  }

  let pages: string[];
  try {
    pages = await extractPdfPages(pdf);
  } catch {
    return fail(400, "unreadable_pdf", "That PDF couldn't be read. It may be damaged or password protected.");
  }

  const contract = recheck(parsed.data, pages);
  const pending = unacknowledged(contract);
  if (pending.length > 0) {
    return fail(422, "needs_confirmation", `Please confirm these before saving: ${pending.join(", ")}.`);
  }

  const wedding = weddingId ? await deps.prisma.wedding.findUnique({ where: { id: weddingId } }) : null;
  if (!wedding) return fail(409, "no_wedding", "Set up your wedding first, then add contracts to it.");

  const rootDir = deps.rootDir ?? process.cwd();
  let written = null as string | null;

  try {
    const vendor = await deps.prisma.$transaction(async (tx) => {
      const paypalEmail =
        contract.paypalEmail || vendorEmail((await tx.vendor.count({ where: { weddingId: wedding.id } })) + 1, parseVendorEmails(deps.vendorEmails).valid);

      const created = await tx.vendor.create({
        data: {
          weddingId: wedding.id,
          name: contract.vendorName,
          category: contract.category.toLowerCase(),
          paypalEmail,
          contractPath: "",
          signingDate: utc(contract.signingDate),
          totalCost: contract.totalCents,
        },
      });
      const contractPath = uploadedContractPath(created.id);

      for (const p of contract.payments) {
        const clause = await tx.clause.create({
          data: { vendorId: created.id, kind: "payment", text: p.clauseQuote, page: p.page, summary: p.label },
        });
        await tx.payment.create({
          data: {
            vendorId: created.id,
            label: p.label,
            amount: p.amountCents,
            anchor: p.anchor,
            offsetDays: p.anchor === "fixed" ? 0 : p.offsetDays,
            fixedDate: p.anchor === "fixed" && p.fixedDate ? utc(p.fixedDate) : null,
            status: "scheduled",
            clauseId: clause.id,
          },
        });
      }

      const clauseIds: string[] = [];
      if (contract.cancellation.found) {
        const c = contract.cancellation;
        const clause = await tx.clause.create({
          data: { vendorId: created.id, kind: "cancellation", text: c.clauseQuote, page: c.page, summary: "Cancellation and refunds" },
        });
        clauseIds.push(clause.id);
      }
      if (contract.dateChange.found) {
        const d = contract.dateChange;
        const clause = await tx.clause.create({
          data: { vendorId: created.id, kind: "date_change", text: d.clauseQuote, page: d.page, summary: "Changing the event date" },
        });
        clauseIds.push(clause.id);
      }

      await tx.terms.create({
        data: {
          vendorId: created.id,
          cancellationRules: contract.cancellation.found ? contract.cancellation.rules : [],
          dateChangeRules: contract.dateChange.found ? contract.dateChange.rules : [],
          clauseIds,
        },
      });

      await tx.eventLog.create({
        data: {
          weddingId: wedding.id,
          type: "contract_uploaded",
          message: `Added ${contract.vendorName} from an uploaded contract (${contract.payments.length} payments)`,
        },
      });

      // Write the file last, inside the transaction: if it fails, nothing is saved.
      const target = path.join(rootDir, ...contractPath.split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, pdf);
      written = target;

      return tx.vendor.update({ where: { id: created.id }, data: { contractPath } });
    });

    return Response.json({
      ok: true,
      vendorId: vendor.id,
      vendorName: vendor.name,
      message: `${vendor.name} is on your timeline.`,
    });
  } catch (error) {
    // The transaction rolled back; don't leave its PDF behind.
    if (written) await rm(written, { force: true }).catch(() => {});
    console.error("[vowlet] Saving an uploaded contract failed:", error);
    return fail(500, "save_failed", "Couldn't save this contract. Nothing was changed. Please try again.");
  }
}
