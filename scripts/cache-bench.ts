/**
 * Does Gemini reuse the agent's prompt prefix between questions? Runs the real
 * agent loop on a few questions in a row and prints, per question, the input
 * tokens, how many of them came from Gemini's cache, and the time taken.
 *
 *   npm run cache:bench                 (uses a copy of dev.db, never dev.db itself)
 *   npm run cache:bench -- --rounds 2   (ask the set of questions twice)
 *
 * Needs GEMINI_API_KEY in .env.local. Spends a few free-tier requests per question.
 */
import { config } from "dotenv";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runAgent } from "@/lib/agent/loop";
import { createPrismaClient } from "@/lib/db";
import { createGeminiClient, type LlmUsage } from "@/lib/llm/gemini";
import { modelChain } from "@/lib/llm/config";

config({ path: ".env.local" });

const QUESTIONS = ["What do we owe in the next 30 days?", "What if we move the wedding to June 12?", "Which vendors have we paid so far?"];

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--rounds");
  const rounds = i >= 0 ? Math.max(1, Number(args[i + 1]) || 1) : 1;

  if (!existsSync("dev.db")) throw new Error("dev.db not found: start the app once so it is created and seeded.");
  const dir = mkdtempSync(path.join(tmpdir(), "vowlet-cache-"));
  const dbFile = path.join(dir, "bench.db");
  copyFileSync("dev.db", dbFile);
  const prisma = createPrismaClient(`file:${dbFile}`);
  const client = createGeminiClient({ apiKey: process.env.GEMINI_API_KEY });
  const models = modelChain("agent");

  console.log(`Model chain: ${models.join(" -> ")}\n`);
  console.log("question".padEnd(46), "model".padEnd(24), "steps", "input".padStart(7), "cached".padStart(7), "  share", "   time");
  try {
    for (let r = 1; r <= rounds; r++) {
      for (const question of QUESTIONS) {
        const started = Date.now();
        let usage: LlmUsage | null = null;
        let model = "-";
        let steps = 0;
        let failed = "";
        for await (const event of runAgent({ question, client, models, prisma, today: new Date() })) {
          if (event.type === "answer") {
            usage = event.usage;
            model = event.model ?? "-";
            steps = event.iterations;
          }
          if (event.type === "error") failed = event.message;
        }
        const ms = Date.now() - started;
        const u: LlmUsage | null = usage;
        if (!u) {
          console.log(question.padEnd(46), `FAILED: ${failed}`);
          continue;
        }
        const share = u.inputTokens === 0 ? 0 : u.cachedTokens / u.inputTokens;
        console.log(
          question.slice(0, 45).padEnd(46),
          model.padEnd(24),
          String(steps).padStart(5),
          String(u.inputTokens).padStart(7),
          String(u.cachedTokens).padStart(7),
          `${(share * 100).toFixed(0)}%`.padStart(7),
          `${(ms / 1000).toFixed(1)}s`.padStart(7),
        );
      }
    }
  } finally {
    await prisma.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
