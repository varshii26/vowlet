import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolError, defineTool, isoDateSchema, parseIsoDate, type ToolContext } from "@/lib/agent/tools/types";

const ctx = {} as ToolContext; // these tools never touch the context

/** The ToolError a refused call throws. Fails the test if the call succeeded or threw something else. */
async function refusal(call: Promise<unknown>): Promise<ToolError> {
  try {
    await call;
  } catch (error) {
    if (error instanceof ToolError) return error;
    throw error;
  }
  throw new Error("expected the tool to refuse the call");
}

describe("defineTool", () => {
  const add = defineTool({
    name: "add",
    description: "adds",
    inputSchema: z.object({ a: z.number(), b: z.number().optional() }),
    run: async ({ a, b }) => ({ sum: a + (b ?? 0) }),
  });

  it("runs the tool with validated input", async () => {
    expect(await add.execute({ a: 2, b: 3 }, ctx)).toEqual({ sum: 5 });
    expect(await add.execute({ a: 2 }, ctx)).toEqual({ sum: 2 });
  });

  it("refuses bad input with a message naming the field, as a ToolError the model can act on", async () => {
    const failure = await refusal(add.execute({ a: "two" }, ctx));
    expect(failure.name).toBe("ToolError");
    expect(failure.message).toContain("Invalid arguments for add");
    expect(failure.message).toContain("a:");
  });

  it("names every problem at once", async () => {
    const two = defineTool({ name: "two", description: "", inputSchema: z.object({ x: z.number(), y: z.number() }), run: async () => 1 });
    const failure = await refusal(two.execute({}, ctx));
    expect(failure.message).toContain("x:");
    expect(failure.message).toContain("y:");
  });

  it("does not run the tool when the input is invalid", async () => {
    let ran = false;
    const t = defineTool({ name: "t", description: "", inputSchema: z.object({ a: z.number() }), run: async () => { ran = true; } });
    await t.execute({ a: "x" }, ctx).catch(() => {});
    expect(ran).toBe(false);
  });

  it("drops fields the schema does not know, so extra arguments cannot sneak through", async () => {
    let seen: unknown;
    const t = defineTool({ name: "t", description: "", inputSchema: z.object({ a: z.number() }), run: async (input) => { seen = input; } });
    await t.execute({ a: 1, amountCents: 999_999 }, ctx);
    expect(seen).toEqual({ a: 1 });
  });

  it("lets a tool with no arguments be called with nothing at all", async () => {
    const none = defineTool({ name: "none", description: "", inputSchema: z.object({}), run: async () => "ran" });
    expect(await none.execute(undefined, ctx)).toBe("ran");
    expect(await none.execute(null, ctx)).toBe("ran");
    expect(await none.execute({}, ctx)).toBe("ran");
  });

  it("keeps its name, description and schema for the registry", () => {
    expect(add).toMatchObject({ name: "add", description: "adds" });
    expect(add.inputSchema).toBeDefined();
  });
});

describe("isoDateSchema", () => {
  it("accepts a real calendar date", () => {
    expect(isoDateSchema.safeParse("2027-06-12").success).toBe(true);
    expect(isoDateSchema.safeParse("2028-02-29").success).toBe(true);
  });

  it.each(["2027-02-30", "2027-13-01", "2027-00-10", "2027-6-12", "12/06/2027", "June 12, 2027", "2027-06-12T00:00:00Z", "", " 2027-06-12"])(
    "rejects %j",
    (value) => {
      expect(isoDateSchema.safeParse(value).success).toBe(false);
    },
  );

  it("rejects 29 February in a year that has none", () => {
    expect(isoDateSchema.safeParse("2027-02-29").success).toBe(false);
  });

  it("says what format is wanted", () => {
    const result = isoDateSchema.safeParse("soon");
    expect(result.success ? "" : result.error.issues[0].message).toContain("YYYY-MM-DD");
  });
});

describe("parseIsoDate", () => {
  it("is midnight UTC", () => {
    expect(parseIsoDate("2027-04-17").toISOString()).toBe("2027-04-17T00:00:00.000Z");
  });
});
