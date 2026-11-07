import type { FunctionDeclaration } from "@google/genai";
import { z } from "zod";
import { computeDateChangeCostTool, computeRefundOwedTool } from "@/lib/agent/tools/compute";
import { proposeAction } from "@/lib/agent/tools/propose";
import { getPaymentSchedule, getVendors, getWedding, readClause } from "@/lib/agent/tools/read";
import { ToolError, type AgentTool, type ToolContext } from "@/lib/agent/tools/types";

export { ToolError, type AgentTool, type ToolContext } from "@/lib/agent/tools/types";

/** The seven tools, and only these seven. Clear descriptions matter more than count. */
export const agentTools: readonly AgentTool[] = [
  getWedding,
  getVendors,
  getPaymentSchedule,
  readClause,
  computeDateChangeCostTool,
  computeRefundOwedTool,
  proposeAction,
];

const byName = new Map(agentTools.map((tool) => [tool.name, tool]));

/**
 * The tools as Gemini function declarations. The JSON Schema comes from the same
 * Zod schema that validates the arguments, so the two cannot drift apart.
 */
export function toolDeclarations(): FunctionDeclaration[] {
  return agentTools.map((tool) => {
    const schema = z.toJSONSchema(tool.inputSchema) as Record<string, unknown>;
    delete schema.$schema;
    const takesArguments = Object.keys((schema.properties as Record<string, unknown> | undefined) ?? {}).length > 0;
    // Gemini wants no parameters block at all for a tool without arguments.
    return takesArguments
      ? { name: tool.name, description: tool.description, parametersJsonSchema: schema }
      : { name: tool.name, description: tool.description };
  });
}

export type ToolOutcome = { ok: true; output: unknown } | { ok: false; error: string };

/**
 * Run a tool the model asked for. Never throws: a problem the model can fix
 * comes back as an error message, and anything unexpected as a generic one, so
 * the agent loop can hand either straight back to the model as the tool result.
 */
export async function executeTool(name: string, rawArgs: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const tool = byName.get(name);
  if (!tool) {
    return { ok: false, error: `Unknown tool "${name}". The tools are: ${[...byName.keys()].join(", ")}.` };
  }
  try {
    return { ok: true, output: await tool.execute(rawArgs, ctx) };
  } catch (error) {
    if (error instanceof ToolError) return { ok: false, error: error.message };
    // Log for us; tell the model nothing about the internals.
    console.error(`[agent] tool ${name} failed:`, error instanceof Error ? error.message : error);
    return { ok: false, error: "That tool failed unexpectedly. Try again, or answer without it." };
  }
}
