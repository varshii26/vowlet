import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { agentTools, executeTool, toolDeclarations } from "@/lib/agent/tools";
import { TODAY, ok, refused } from "@/lib/agent/tools/test-utils";
import { seedDemo } from "@/lib/seed/demo";
import { createTestDatabase } from "@/lib/test-utils/db";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, cleanup } = createTestDatabase());
  await seedDemo(prisma);
}, 60_000);
afterAll(async () => cleanup());

/** The seven tools in the spec, plus the read-only PayPal lookup from #31. */
const TOOLS = [
  "get_wedding",
  "get_vendors",
  "get_payment_schedule",
  "read_clause",
  "compute_date_change_cost",
  "compute_refund_owed",
  "propose_action",
  "check_payment_status",
];

describe("the tool set", () => {
  it("is exactly the seven tools in the spec plus the read-only PayPal lookup, and no others", () => {
    expect(agentTools.map((t) => t.name)).toEqual(TOOLS);
  });

  it("has a real description for each, so the model knows when to use it", () => {
    for (const tool of agentTools) expect(tool.description.length, tool.name).toBeGreaterThan(40);
  });

  it("points the model at code for numbers instead of letting it calculate", () => {
    const text = (name: string) => agentTools.find((t) => t.name === name)!.description;
    expect(text("compute_date_change_cost")).toContain("Never work out costs yourself");
    expect(text("compute_refund_owed")).toContain("Never work out amounts yourself");
    expect(text("propose_action")).toContain("amounts are worked out for you");
  });
});

describe("toolDeclarations", () => {
  const declarations = toolDeclarations();
  const named = (name: string) => declarations.find((d) => d.name === name)!;

  it("declares each tool by name with its description", () => {
    expect(declarations.map((d) => d.name)).toEqual(TOOLS);
    for (const d of declarations) expect(d.description).toBeTruthy();
  });

  it("uses only JSON Schema that Gemini accepts: no $schema marker, unions or nulls", () => {
    const text = JSON.stringify(declarations);
    expect(text).not.toContain("$schema");
    expect(text).not.toContain("anyOf");
    expect(text).not.toContain("oneOf");
    expect(text).not.toContain('"null"');
  });

  it("gives a tool with no arguments no parameters block at all", () => {
    expect(named("get_wedding")).not.toHaveProperty("parametersJsonSchema");
  });

  it("requires only what is needed", () => {
    const required = (name: string) => (named(name).parametersJsonSchema as { required?: string[] }).required ?? [];
    expect(required("compute_date_change_cost")).toEqual(["newDate"]);
    expect(required("compute_refund_owed")).toEqual(["vendorId", "cancelledBy"]);
    expect(required("read_clause")).toEqual(["vendorId", "kind"]);
    expect(required("propose_action")).toEqual(["kind", "reason"]);
    expect(required("get_vendors")).toEqual([]);
  });

  it("describes dates and enums so the model can fill them in correctly", () => {
    const props = (name: string) => (named(name).parametersJsonSchema as { properties: Record<string, Record<string, unknown>> }).properties;
    expect(props("compute_date_change_cost").newDate.description).toContain("YYYY-MM-DD");
    expect(props("compute_refund_owed").cancelledBy.enum).toEqual(["couple", "vendor"]);
    expect(props("propose_action").kind.enum).toEqual(["pay", "reschedule", "refund_request", "message"]);
  });

  it("gives propose_action no field that could carry an amount or a payee", () => {
    const fields = Object.keys((named("propose_action").parametersJsonSchema as { properties: object }).properties);
    expect(fields.sort()).toEqual(["cancelledBy", "clauseId", "kind", "message", "newDate", "paymentId", "reason", "vendorId"]);
    expect(fields.join(" ")).not.toMatch(/amount|cents|payee|email|total/i);
  });

  it("comes from the same schema that validates the arguments", () => {
    const schemaKeys = (name: string) => Object.keys((named(name).parametersJsonSchema as { properties: object }).properties).sort();
    expect(schemaKeys("get_payment_schedule")).toEqual(["from", "to", "unpaidDueWithinDays", "vendorId"]);
  });
});

describe("executeTool", () => {
  it("returns a tool's output", async () => {
    const outcome = await executeTool("get_wedding", {}, { prisma, today: TODAY });
    expect(outcome.ok).toBe(true);
  });

  it("answers an unknown tool by listing the real ones, and does not throw", async () => {
    const message = await refused(prisma, "delete_everything");
    expect(message).toContain('Unknown tool "delete_everything"');
    for (const name of TOOLS) expect(message).toContain(name);
  });

  it("does not offer a way to pay, capture, refund or transfer", () => {
    expect(agentTools.map((t) => t.name).join(" ")).not.toMatch(/pay_|capture|refund_vendor|transfer|send|charge/);
  });

  it("returns invalid arguments to the model as an error message it can act on", async () => {
    const message = await refused(prisma, "compute_date_change_cost", { newDate: "soon" });
    expect(message).toContain("Invalid arguments for compute_date_change_cost");
    expect(message).toContain("newDate");
  });

  it("returns arguments of the wrong type as an error too, never a crash", async () => {
    for (const args of ["a string", 42, [], { vendorId: 5, kind: {} }, true]) {
      const outcome = await executeTool("read_clause", args, { prisma, today: TODAY });
      expect(outcome.ok, JSON.stringify(args)).toBe(false);
    }
  });

  it("hides unexpected failures behind a generic message, and logs them for us", async () => {
    const broken = { wedding: { findFirst: () => Promise.reject(new TypeError("SECRET connection string")) } } as unknown as PrismaClient;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const outcome = await executeTool("get_wedding", {}, { prisma: broken, today: TODAY });
      expect(outcome).toEqual({ ok: false, error: "That tool failed unexpectedly. Try again, or answer without it." });
      expect(JSON.stringify(outcome)).not.toContain("SECRET");
      expect(log).toHaveBeenCalledWith(expect.stringContaining("get_wedding"), "SECRET connection string");
    } finally {
      log.mockRestore();
    }
  });

  it("returns output that survives JSON, so it can go straight back to the model", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [
      ["get_wedding", {}],
      ["get_vendors", {}],
      ["get_payment_schedule", {}],
      ["read_clause", { vendorId: "florist", kind: "payment" }],
      ["compute_date_change_cost", { newDate: "2027-06-17" }],
      ["compute_refund_owed", { vendorId: "Grand Oak Estate", cancelledBy: "couple" }],
    ];
    for (const [name, args] of calls) {
      const output = await ok(prisma, name, args);
      expect(JSON.parse(JSON.stringify(output)), name).toEqual(output); // no Dates, undefined or BigInt
    }
  });
});

describe("no tool can move money", () => {
  const dir = path.join(process.cwd(), "lib", "agent", "tools");
  const sources = readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "test-utils.ts")
    .map((f) => ({ file: f, text: readFileSync(path.join(dir, f), "utf8") }));

  it("found the tool source files", () => {
    expect(sources.map((s) => s.file).sort()).toEqual(["compute.ts", "data.ts", "index.ts", "propose.ts", "read.ts", "status.ts", "types.ts"]);
  });

  it("never imports anything that talks to PayPal or settles a payment", () => {
    for (const { file, text } of sources) {
      expect(text, file).not.toMatch(/from\s+["']@\/lib\/paypal["']/);
      expect(text, file).not.toMatch(/from\s+["']@\/lib\/payments/);
      expect(text, file).not.toMatch(/paypal-server-sdk|react-paypal/);
      expect(text, file).not.toMatch(/captureOrder|createOrder|refundCapture|markPaymentPaid|createPaymentOrder/);
    }
  });

  it("never writes to payments, vendors, the wedding, terms or clauses", () => {
    for (const { file, text } of sources) {
      expect(text, file).not.toMatch(/\.(payment|vendor|wedding|terms|clause)\.(update|updateMany|create|createMany|delete|deleteMany|upsert)\b/);
    }
  });

  it("writes only the proposal and the activity log, and only in propose.ts", () => {
    for (const { file, text } of sources) {
      const writes = [...text.matchAll(/\.(\w+)\.(create|update|updateMany|delete|deleteMany|upsert)\b/g)].map((m) => m[1]);
      if (file === "propose.ts") expect(new Set(writes), file).toEqual(new Set(["proposal", "eventLog"]));
      else expect(writes, file).toEqual([]);
    }
  });
});
