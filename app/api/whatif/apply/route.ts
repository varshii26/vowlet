import { withSession } from "@/lib/auth/guard";
import { requestWeddingId } from "@/lib/auth/request-wedding";
import { prisma } from "@/lib/db";
import { applyWhatIfHandler } from "@/lib/whatif/handler";

// Called only by the Confirm button in the what-if panel: the couple's approval.
async function handlePOST(request: Request) {
  return applyWhatIfHandler(request, { prisma, resolveWeddingId: requestWeddingId });
}

export const POST = withSession(handlePOST);
