import type { PrismaClient } from "@/generated/prisma/client";

/** How an activity entry is shown: good news, something to check, or neutral. */
export type ActivityTone = "success" | "warning" | "neutral";

export type ActivityItem = {
  id: string;
  type: string;
  message: string;
  /** ISO timestamp. */
  at: string;
  tone: ActivityTone;
};

const SUCCESS = new Set(["payment_paid", "proposal_approved", "contract_uploaded"]);

/** Payment problems the webhook logs for a person to look at. */
const isWarning = (type: string) => type.endsWith("_mismatch") || type.startsWith("payment_unexpected") || type.startsWith("payment_duplicate") || type.endsWith("_failed");

export function activityTone(type: string): ActivityTone {
  if (isWarning(type)) return "warning";
  return SUCCESS.has(type) ? "success" : "neutral";
}

export const ACTIVITY_LIMIT = 12;

/** The wedding's most recent activity, newest first. Every action that changes something writes an EventLog row. */
export async function loadActivity(prisma: PrismaClient, weddingId: string, limit = ACTIVITY_LIMIT): Promise<ActivityItem[]> {
  const rows = await prisma.eventLog.findMany({ where: { weddingId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit });
  return rows.map((r) => ({ id: r.id, type: r.type, message: r.message, at: r.createdAt.toISOString(), tone: activityTone(r.type) }));
}
