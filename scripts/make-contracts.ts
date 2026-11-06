import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildAllContracts } from "@/lib/contracts/document";
import { renderContractPdf } from "@/lib/contracts/pdf";

// Regenerates seed/contracts/*.pdf from the demo data in lib/seed/demo-data.ts.
async function main() {
  const outDir = path.join(process.cwd(), "seed", "contracts");
  await mkdir(outDir, { recursive: true });

  for (const contract of buildAllContracts()) {
    const pdf = await renderContractPdf(contract);
    await writeFile(path.join(outDir, `${contract.slug}.pdf`), pdf);
    console.log(`${contract.slug}.pdf  ${contract.pages.length} pages  ${pdf.length} bytes`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
