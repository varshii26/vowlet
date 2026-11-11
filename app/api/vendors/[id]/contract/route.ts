import { withSession } from "@/lib/auth/guard";
import { requestWeddingId } from "@/lib/auth/request-wedding";
import { prisma } from "@/lib/db";
import { contractHandler } from "@/lib/vendors/contract-file";

// The vendor's contract PDF, for the "Open original PDF" link and the embedded viewer.
async function handleGET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return contractHandler(id, { prisma, resolveWeddingId: requestWeddingId });
}

export const GET = withSession(handleGET);
