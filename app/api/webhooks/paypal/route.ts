import { prisma } from "@/lib/db";
import { paypal } from "@/lib/paypal";
import { webhookHandler } from "@/lib/payments/webhook";

// PayPal calls this. It is open to the internet, so every request is verified
// with PayPal (signature + webhook id) before anything changes.
export async function POST(request: Request) {
  return webhookHandler(request, { prisma, paypal });
}
