import { prisma } from "@/lib/db";
import { proposalHandler } from "@/lib/proposals/handler";

// Called only by the Approve and Dismiss buttons on a proposal card.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proposalHandler(id, request, { prisma });
}
