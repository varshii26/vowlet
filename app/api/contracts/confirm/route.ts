import { withSession } from "@/lib/auth/guard";
import { requestWeddingId } from "@/lib/auth/request-wedding";
import { prisma } from "@/lib/db";
import { createRateLimiter } from "@/lib/rate-limit";
import { confirmHandler } from "@/lib/upload/confirm";

// Module scope: one limiter for the life of the server process. The endpoint is
// public and writes to disk, so a handful of saves a minute is plenty.
const limiter = createRateLimiter({ max: 10, windowMs: 60_000 });

// Called only by the Confirm button on the upload page, after the couple reviewed the terms.
async function handlePOST(request: Request) {
  return confirmHandler(request, { prisma, limiter, resolveWeddingId: requestWeddingId, vendorEmails: process.env.PAYPAL_VENDOR_EMAILS });
}

export const POST = withSession(handlePOST);
