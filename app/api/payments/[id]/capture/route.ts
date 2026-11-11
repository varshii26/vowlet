import { withSession } from "@/lib/auth/guard";
import { requestWeddingId } from "@/lib/auth/request-wedding";
import { prisma } from "@/lib/db";
import { captureHandler } from "@/lib/payments/handlers";
import { paypal } from "@/lib/paypal";

async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return captureHandler(id, request, { prisma, paypal, resolveWeddingId: requestWeddingId });
}

export const POST = withSession(handlePOST);
