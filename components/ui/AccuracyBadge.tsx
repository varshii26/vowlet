import rawResults from "@/evals/results.json";
import { evalResultsSchema, type EvalResults } from "@/evals/results";

/** Where the README explains the eval (how it scores, and what it doesn't prove). */
export const EVAL_README_URL = "https://github.com/varshii26/vowlet#evaluation";

/** "100%", "98.5%": one decimal, none when it's whole. */
export function formatPercent(share: number): string {
  const tenths = Math.round(share * 1000) / 10;
  return `${Number.isInteger(tenths) ? tenths.toFixed(0) : tenths.toFixed(1)}%`;
}

/** The badge's text, from the results of the last full `npm run eval`. */
export function badgeText(r: EvalResults): { label: string; title: string } {
  return {
    label: `Extraction accuracy ${formatPercent(r.accuracy)} on ${r.contracts} contracts · ${formatPercent(r.quoteRate)} of quotes verified`,
    title: `From npm run eval on ${r.date} with ${r.models.join(", ")}: ${r.correct}/${r.total} fields exactly right. Generated sample contracts; see the README for what this does and doesn't show.`,
  };
}

const parsed = evalResultsSchema.safeParse(rawResults);

/**
 * How well contract reading did on the sample contracts, straight from
 * evals/results.json, which `npm run eval` writes. Nothing here is typed by
 * hand; without a valid results file the badge doesn't show.
 */
export function AccuracyBadge({ results = parsed.success ? parsed.data : null }: { results?: EvalResults | null }) {
  if (!results) return null;
  const { label, title } = badgeText(results);
  return (
    <a
      href={EVAL_README_URL}
      target="_blank"
      rel="noreferrer"
      title={title}
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-ink"
    >
      <span aria-hidden className="text-emerald-700">
        ✓
      </span>
      {label}
    </a>
  );
}
