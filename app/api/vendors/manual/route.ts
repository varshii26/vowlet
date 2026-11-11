import { withSession } from "@/lib/auth/guard";
import { requestWeddingId } from "@/lib/auth/request-wedding";
import { prisma } from "@/lib/db";
import { manualVendorHandler } from "@/lib/manual/handler";
import { createRateLimiter } from "@/lib/rate-limit";

// Module scope: one limiter for the life of the server process, counted per wedding.
const limiter = createRateLimiter({ max: 20, windowMs: 60_000 });

// A vendor the couple typed in because they have no contract to upload.
async function handlePOST(request: Request) {
  return manualVendorHandler(request, { prisma, limiter, resolveWeddingId: requestWeddingId, vendorEmails: process.env.PAYPAL_VENDOR_EMAILS });
}

export const POST = withSession(handlePOST);
