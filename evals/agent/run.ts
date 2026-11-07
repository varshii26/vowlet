/**
 * Agent smoke tests against the real model: `npm run eval:agent`.
 * Run before a demo to catch regressions. Each question gets a freshly seeded
 * temporary database, so nothing touches dev.db and runs don't affect each other.
 *
 *   npm run eval:agent
 *   npm run eval:agent -- --only "a vendor cancels"
 *
 * Needs GEMINI_API_KEY in .env.local. Exits 1 if any check fails.
 */
import { config } from "dotenv";
import type { Content } from "@google/genai";
import { expectFrom, SMOKE_CASES, toolCallsFrom, type RunRecord } from "@/evals/agent/smoke";
import { runAgent } from "@/lib/agent/loop";
import { createGeminiClient, type GeminiClient } from "@/lib/llm/gemini";
import { modelChain } from "@/lib/llm/config";
import { seedDemo } from "@/lib/seed/demo";
import { createTestDatabase } from "@/lib/test-utils/db";

config({ path: ".env.local" });

/** The demo's "today", fixed so expected values don't drift day to day. */
const TODAY = new Date("2026-11-07T00:00:00.000Z");

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--only");
  const only = i >= 0 ? args[i + 1] : undefined;
  const cases = SMOKE_CASES.filter((c) => !only || c.name === only);
  if (cases.length === 0) throw new Error(`No case named "${only}". Cases: ${SMOKE_CASES.map((c) => c.name).join(", ")}`);
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set (put it in .env.local).");

  const base = createGeminiClient({ apiKey: process.env.GEMINI_API_KEY });
  const models = modelChain("agent");
  console.log(`Agent smoke tests with ${models.join(" -> ")}\n`);

  const { prisma, cleanup } = createTestDatabase();
  let failedCases = 0;
  try {
    for (const smoke of cases) {
      await seedDemo(prisma);
      const checks = await smoke.checks(expectFrom(prisma, TODAY));
      const statuses = async () => new Map((await prisma.payment.findMany({ select: { id: true, status: true } })).map((p) => [p.id, p.status]));
      const paymentsBefore = await statuses();

      // Keep the last conversation the loop sent: it holds every tool call and its result.
      let lastContents: Content[] = [];
      const client: GeminiClient = {
        ...base,
        generateWithFallback: async (m, request) => {
          lastContents = (request.contents ?? []) as Content[];
          return base.generateWithFallback(m, request);
        },
      };

      const started = Date.now();
      let answer = "";
      let proposals: RunRecord["proposals"] = [];
      let error = "";
      for await (const event of runAgent({ question: smoke.question, client, models, prisma, today: TODAY })) {
        if (event.type === "answer") ({ text: answer, proposals } = event);
        if (event.type === "error") error = event.message;
      }
      const record: RunRecord = { answer, tools: toolCallsFrom(lastContents), proposals, paymentsBefore, paymentsAfter: await statuses() };

      const failures = error ? [`the agent failed: ${error}`] : checks.map((check) => check(record)).filter((f): f is string => f !== null);
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`${failures.length === 0 ? "PASS" : "FAIL"}  ${smoke.name.padEnd(26)} ${seconds}s  tools: ${record.tools.map((t) => t.name).join(", ") || "none"}`);
      for (const f of failures) console.log(`      - ${f}`);
      if (failures.length > 0) {
        failedCases++;
        console.log(`      answer: ${answer.replace(/\s+/g, " ").slice(0, 300)}`);
      }
    }
  } finally {
    await cleanup();
  }

  console.log(`\n${cases.length - failedCases}/${cases.length} passed.`);
  if (failedCases > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
