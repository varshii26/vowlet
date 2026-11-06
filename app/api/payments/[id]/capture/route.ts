import { prisma } from "@/lib/db";
import { captureHandler } from "@/lib/payments/handlers";
import { paypal } from "@/lib/paypal";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return captureHandler(id, request, { prisma, paypal });
}
