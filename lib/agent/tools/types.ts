import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Agent tools. Each one validates its input with Zod, then runs. A problem the
 * model can fix (a bad date, an unknown vendor) is a `ToolError`: its message
 * goes back to the model as the tool result. Anything else is hidden behind a
 * generic message, so internals never reach the model or the browser.
 *
 * No tool can move money. Tools read, compute, or record a proposal; paying
 * happens elsewhere, after the couple approves.
 */

export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

export type ToolContext = {
  prisma: PrismaClient;
  /** "Today", passed in so results are reproducible in tests. */
  today: Date;
};

export type AgentTool = {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  /** Validates `rawArgs` against the schema, then runs. Throws `ToolError` for fixable problems. */
  execute: (rawArgs: unknown, ctx: ToolContext) => Promise<unknown>;
};

export function defineTool<S extends z.ZodType>(definition: {
  name: string;
  description: string;
  inputSchema: S;
  run: (input: z.infer<S>, ctx: ToolContext) => Promise<unknown>;
}): AgentTool {
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema,
    execute: async (rawArgs, ctx) => {
      // A tool with no arguments may be called with nothing at all.
      const parsed = definition.inputSchema.safeParse(rawArgs ?? {});
      if (!parsed.success) {
        const problems = parsed.error.issues.map((issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`);
        throw new ToolError(`Invalid arguments for ${definition.name}. ${problems.join("; ")}`);
      }
      return definition.run(parsed.data, ctx);
    },
  };
}

/** `YYYY-MM-DD` for a real calendar date, as the models are asked to write dates. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date written YYYY-MM-DD")
  .refine((value) => {
    // Zod runs this even when the pattern failed, so it must cope with anything: an invalid Date throws on toISOString.
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "is not a real calendar date");

export const parseIsoDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
