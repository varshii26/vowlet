import type { PrismaClient } from "@/generated/prisma/client";
import { toProposalView, type ProposalView } from "@/lib/proposals/view";

/** The proposals waiting for the couple, oldest first, ready for the cards. Server only. */
export async function loadPendingProposals(prisma: PrismaClient, weddingId: string): Promise<ProposalView[]> {
  const rows = await prisma.proposal.findMany({
    where: { weddingId, status: "pending" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { clause: { include: { vendor: true } } },
  });
  return rows.map(toProposalView);
}
