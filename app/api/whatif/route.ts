import { withSession } from "@/lib/auth/guard";
import { requestWeddingId } from "@/lib/auth/request-wedding";
import { prisma } from "@/lib/db";
import { whatIfHandler } from "@/lib/whatif/handler";

// Pure code from the contract terms: no LLM, so it is fast enough to run on every drag.
async function handlePOST(request: Request) {
  return whatIfHandler(request, { prisma, resolveWeddingId: requestWeddingId });
}

export const POST = withSession(handlePOST);
