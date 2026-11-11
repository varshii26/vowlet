import type { PrismaClient } from "@/generated/prisma/client";
import { manualVendorSchema, totalOf } from "@/lib/manual/schema";
import type { RateLimiter } from "@/lib/rate-limit";
import { parseVendorEmails, vendorEmail } from "@/lib/seed/vendor-emails";

export type ManualDeps = {
  prisma: PrismaClient;
  limiter: RateLimiter;
  /** The wedding the signed-in caller is working on, from their session; null if they have none yet. */
  resolveWeddingId: () => Promise<string | null>;
  /** Sandbox payee emails for vendors added without one (PAYPAL_VENDOR_EMAILS). */
  vendorEmails?: string;
};

const fail = (status: number, code: string, message: string, headers?: HeadersInit) =>
  Response.json({ ok: false, error: { code, message } }, { status, headers });

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * POST /api/vendors/manual: a vendor the couple typed in because they have no
 * contract to upload. It is saved like an uploaded one (a vendor, its payments, its
 * terms, an activity entry), but with no PDF and no clauses, since there is nothing to
 * cite. The total is what the payments add up to. Written in one transaction.
 */
export async function manualVendorHandler(request: Request, deps: ManualDeps): Promise<Response> {
  const weddingId = await deps.resolveWeddingId();
  const limit = deps.limiter.check(weddingId ?? undefined);
  if (!limit.allowed) {
    const seconds = Math.max(1, Math.ceil(limit.retryAfterMs / 1000));
    return fail(429, "too_many_requests", `Too many vendors added at once. Try again in ${seconds} seconds.`, { "Retry-After": String(seconds) });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return fail(400, "bad_request", "Send the vendor's details as JSON.");
  }
  const parsed = manualVendorSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return fail(400, "invalid", `${first?.path.join(".") || "vendor"}: ${first?.message ?? "not valid"}`);
  }
  const vendor = parsed.data;

  const wedding = weddingId ? await deps.prisma.wedding.findUnique({ where: { id: weddingId } }) : null;
  if (!wedding) return fail(409, "no_wedding", "Set up your wedding first, then add vendors to it.");

  try {
    const created = await deps.prisma.$transaction(async (tx) => {
      const paypalEmail =
        vendor.paypalEmail || vendorEmail((await tx.vendor.count({ where: { weddingId: wedding.id } })) + 1, parseVendorEmails(deps.vendorEmails).valid);

      const row = await tx.vendor.create({
        data: {
          weddingId: wedding.id,
          name: vendor.vendorName,
          category: vendor.category.toLowerCase(),
          paypalEmail,
          contractPath: "", // no contract on file
          notes: vendor.notes,
          signingDate: utc(vendor.signingDate),
          totalCost: totalOf(vendor.payments),
        },
      });
      for (const p of vendor.payments) {
        await tx.payment.create({
          data: {
            vendorId: row.id,
            label: p.label,
            amount: p.amountCents,
            anchor: p.anchor,
            offsetDays: p.anchor === "fixed" ? 0 : p.offsetDays,
            fixedDate: p.anchor === "fixed" && p.fixedDate ? utc(p.fixedDate) : null,
            status: "scheduled",
            clauseId: null,
          },
        });
      }
      await tx.terms.create({
        data: { vendorId: row.id, cancellationRules: vendor.cancellationRules, dateChangeRules: vendor.dateChangeRules, clauseIds: [] },
      });
      await tx.eventLog.create({
        data: { weddingId: wedding.id, type: "vendor_added_manually", message: `Added ${vendor.vendorName} by hand (${vendor.payments.length} payment${vendor.payments.length === 1 ? "" : "s"})` },
      });
      return row;
    });
    return Response.json({ ok: true, vendorId: created.id, vendorName: created.name, message: `${created.name} is on your timeline.` });
  } catch (error) {
    console.error("[vowlet] Saving a manually entered vendor failed:", error);
    return fail(500, "save_failed", "Couldn't save this vendor. Nothing was changed. Please try again.");
  }
}
