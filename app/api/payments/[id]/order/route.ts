import { withSession } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { createOrderHandler } from "@/lib/payments/handlers";
import { paypal } from "@/lib/paypal";

async function handlePOST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return createOrderHandler(id, { prisma, paypal });
}

export const POST = withSession(handlePOST);
