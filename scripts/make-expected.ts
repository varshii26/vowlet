/** Rewrites evals/expected/<slug>.json from the demo data the sample contracts are generated from: `npm run eval:expected`. */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { EXPECTED_DIR, expectedJson } from "@/evals/expected";
import { VENDORS } from "@/lib/seed/demo-data";

async function main() {
  await mkdir(EXPECTED_DIR, { recursive: true });
  for (const spec of VENDORS) await writeFile(path.join(EXPECTED_DIR, `${spec.slug}.json`), expectedJson(spec));
  console.log(`Wrote ${VENDORS.length} files to ${path.relative(process.cwd(), EXPECTED_DIR)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
