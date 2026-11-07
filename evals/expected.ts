import { readFileSync } from "node:fs";
import path from "node:path";
import type { Expected } from "@/evals/score";
import type { VendorSpec } from "@/lib/seed/demo-data";

/** The part of a vendor spec an extraction is judged against. Key order is fixed so the JSON files diff cleanly. */
export function toExpected(spec: VendorSpec): Expected & { name: string } {
  return {
    slug: spec.slug,
    name: spec.name,
    payments: spec.payments.map((p) => ({
      label: p.label,
      amountCents: p.amountCents,
      anchor: p.anchor,
      ...(p.offsetDays !== undefined ? { offsetDays: p.offsetDays } : {}),
      ...(p.fixedDate !== undefined ? { fixedDate: p.fixedDate } : {}),
      ...(p.ambiguousText !== undefined ? { ambiguousText: p.ambiguousText } : {}),
    })),
    cancellation: spec.cancellation,
    dateChange: spec.dateChange,
  } as Expected & { name: string };
}

export const EXPECTED_DIR = path.join(process.cwd(), "evals", "expected");

export const expectedJson = (spec: VendorSpec) => `${JSON.stringify(toExpected(spec), null, 2)}\n`;

export function loadExpected(slug: string): Expected & { name: string } {
  return JSON.parse(readFileSync(path.join(EXPECTED_DIR, `${slug}.json`), "utf8"));
}
