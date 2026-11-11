import { z } from "zod";
import type { ManualVendor } from "@/lib/manual/schema";

/** Browser side of POST /api/vendors/manual. Nothing here throws; every outcome carries a message. */
const successSchema = z.object({ ok: z.literal(true), vendorId: z.string(), vendorName: z.string(), message: z.string() });
const failureSchema = z.object({ ok: z.literal(false), error: z.object({ message: z.string() }) });

export type SaveManualOutcome = { ok: true; vendorId: string; vendorName: string; message: string } | { ok: false; message: string };

export async function requestSaveManualVendor(vendor: ManualVendor): Promise<SaveManualOutcome> {
  let json: unknown;
  try {
    const res = await fetch("/api/vendors/manual", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(vendor) });
    json = await res.json().catch(() => null);
  } catch {
    return { ok: false, message: "Couldn't reach Vowlet. Check your connection and try again." };
  }
  const success = successSchema.safeParse(json);
  if (success.success) return success.data;
  const failure = failureSchema.safeParse(json);
  return { ok: false, message: failure.success ? failure.data.error.message : "Something unexpected happened. Nothing was saved. Please try again." };
}
