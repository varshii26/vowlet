import { withSession } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { cancelVendorHandler } from "@/lib/vendors/cancel-handler";

// Pure code from the contract terms. Previewing changes nothing; confirming is the couple's click in the CancelModal.
async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return cancelVendorHandler(id, request, { prisma });
}

export const POST = withSession(handlePOST);
