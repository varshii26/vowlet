import type { PrismaClient } from "@/generated/prisma/client";
import { executeTool, type ToolOutcome } from "@/lib/agent/tools";

/** The day every agent-tool test pretends it is. The demo wedding is 2027-04-17, 161 days later. */
export const TODAY = new Date("2026-11-07T00:00:00.000Z");

/** Run a tool by name the way the agent loop will, and expect it to succeed. */
export async function ok(prisma: PrismaClient, name: string, args: unknown = {}, today: Date = TODAY) {
  const outcome = await executeTool(name, args, { prisma, today });
  if (!outcome.ok) throw new Error(`${name} failed: ${outcome.error}`);
  return outcome.output as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- tool output is JSON the tests probe freely
}

/** Run a tool by name and expect it to be refused, returning the message the model would see. */
export async function refused(prisma: PrismaClient, name: string, args: unknown = {}, today: Date = TODAY): Promise<string> {
  const outcome: ToolOutcome = await executeTool(name, args, { prisma, today });
  if (outcome.ok) throw new Error(`${name} should have been refused but returned ${JSON.stringify(outcome.output).slice(0, 120)}`);
  return outcome.error;
}
