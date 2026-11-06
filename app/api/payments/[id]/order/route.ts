import { prisma } from "@/lib/db";
import { createOrderHandler } from "@/lib/payments/handlers";
import { paypal } from "@/lib/paypal";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return createOrderHandler(id, { prisma, paypal });
}
