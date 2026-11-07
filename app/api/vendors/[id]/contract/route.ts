import { prisma } from "@/lib/db";
import { contractHandler } from "@/lib/vendors/contract-file";

// The vendor's contract PDF, for the "Open original PDF" link and the embedded viewer.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return contractHandler(id, { prisma });
}
