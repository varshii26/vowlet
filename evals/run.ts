/**
 * Runs extraction on every sample contract and scores it against evals/expected/*.json.
 *
 *   npm run eval                      all 14
 *   npm run eval -- --only grand-oak-estate,dj-marlow-sound
 *   npm run eval -- --min 90          also fail if overall accuracy is under 90%
 *
 * Needs GEMINI_API_KEY in .env.local. Exits 1 if any extraction fails outright or
 * the accuracy is under --min (default: no minimum). Uses the same models as the app.
 *
 * A full run with no failures writes evals/results.json, which a test checks the
 * README's numbers against (evals/results.ts). Commit it with the README numbers.
 */
import { config } from "dotenv";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadExpected, EXPECTED_DIR } from "@/evals/expected";
import { buildResults, resultsJson } from "@/evals/results";
import { scoreExtraction, type ExtractionScore } from "@/evals/score";
import { extractContract } from "@/lib/extraction/extract";
import { createGeminiClient } from "@/lib/llm/gemini";
import { modelChain } from "@/lib/llm/config";
import { extractPdfPages } from "@/lib/pdf-text";

config({ path: ".env.local" });

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY is not set (put it in .env.local).");
    process.exit(1);
  }

  const only = flag("only")?.split(",").map((s) => s.trim());
  const min = flag("min") !== undefined ? Number(flag("min")) : null;
  const slugs = (await readdir(EXPECTED_DIR)).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).filter((s) => !only || only.includes(s)).sort();
  if (slugs.length === 0) {
    console.error("No expected files found. Run `npm run eval:expected` first.");
    process.exit(1);
  }

  const client = createGeminiClient({ apiKey, timeoutMs: 90_000 });
  const models = modelChain("extraction");
  console.log(`Extracting ${slugs.length} contracts with ${models.join(" -> ")}\n`);

  type Row = { slug: string; score: ExtractionScore | null; ms: number; model: string | null; error?: string };
  const rows: Row[] = [];
  for (const slug of slugs) {
    const expected = loadExpected(slug);
    const pdf = new Uint8Array(await readFile(path.join(process.cwd(), "seed", "contracts", `${slug}.pdf`)));
    const outcome = await extractContract({ client, models, pdf, pages: await extractPdfPages(pdf) });
    rows.push(
      outcome.ok
        ? { slug, score: scoreExtraction(expected, outcome.terms), ms: outcome.ms, model: outcome.model }
        : { slug, score: null, ms: outcome.ms, model: outcome.model, error: outcome.errors[0] ?? "failed" },
    );
    const r = rows[rows.length - 1];
    console.log(r.score ? `${slug.padEnd(30)} ${pct(r.score.accuracy).padStart(5)}  ${r.score.correct}/${r.score.total} fields  quotes ${pct(r.score.quoteRate).padStart(5)}  ${(r.ms / 1000).toFixed(1)}s${r.score.paymentsExtra ? `  (+${r.score.paymentsExtra} extra payments)` : ""}` : `${slug.padEnd(30)} FAILED  ${r.error?.slice(0, 100)}`);
  }

  function pct(n: number) {
    return `${(n * 100).toFixed(1)}%`;
  }

  const scored = rows.filter((r): r is Row & { score: ExtractionScore } => r.score !== null);
  const correct = scored.reduce((s, r) => s + r.score.correct, 0);
  const total = scored.reduce((s, r) => s + r.score.total, 0);
  const accuracy = total === 0 ? 0 : correct / total;
  const quoteRate = scored.length === 0 ? 0 : scored.reduce((s, r) => s + r.score.quoteRate, 0) / scored.length;
  const failed = rows.length - scored.length;

  console.log(`\nExtraction accuracy: ${pct(accuracy)} (${correct}/${total} fields) on ${scored.length} of ${rows.length} contracts, ${pct(quoteRate)} of quotes verified.`);
  if (failed > 0) console.log(`${failed} contract(s) failed to extract.`);
  const flaggedPlain = scored.reduce((s, r) => s + r.score.flags.plainFlagged, 0);
  const vague = scored.filter((r) => r.score.flags.vagueFlagged !== null);
  console.log(`Review flags: ${vague.filter((r) => r.score.flags.vagueFlagged).length}/${vague.length} deliberately vague clause(s) flagged, ${flaggedPlain} clear payment(s) flagged needlessly.`);

  // Only a complete run speaks for the whole set: write what the app shows.
  if (!only && failed === 0) {
    const results = buildResults(
      scored.map((r) => ({ score: r.score, model: r.model ?? "unknown" })),
      new Date(),
    );
    await writeFile(path.join(process.cwd(), "evals", "results.json"), resultsJson(results));
    console.log("Wrote evals/results.json (the README numbers are checked against it).");
  }

  if (failed > 0 || (min !== null && accuracy * 100 < min)) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
