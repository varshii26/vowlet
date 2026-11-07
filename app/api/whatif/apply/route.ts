import { prisma } from "@/lib/db";
import { applyWhatIfHandler } from "@/lib/whatif/handler";

// Called only by the Confirm button in the what-if panel: the couple's approval.
export async function POST(request: Request) {
  return applyWhatIfHandler(request, { prisma });
}
