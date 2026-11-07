/**
 * Clause citations for the agent's answers. Shared by the server (collecting
 * them from tool results) and the browser (turning them into chips), so it
 * imports nothing.
 *
 * A chip is only ever made for a citation one of our tools returned during the
 * run, with the clause id and vendor that tool looked up. The model can write
 * "Some Vendor contract, page 9", but unless a tool returned exactly that, it
 * stays plain text: a chip can't point at a clause the model made up.
 */

export type CitationSource = {
  /** "Grand Oak Estate contract, page 2", exactly as the tools write it. */
  label: string;
  vendorId: string;
  clauseId: string;
  page: number | null;
  /** The clause text, when a tool returned it (read_clause does). */
  text: string | null;
};

const PAGE = /, page (\d+)$/;

/**
 * Adds every citation in a tool result to `into`, keyed by label. A citation is an
 * object with string `citation` and `clauseId`, and a `vendorId` of its own or
 * from the object around it (read_clause puts it once, above its clauses).
 */
export function collectSources(output: unknown, into: Map<string, CitationSource>, vendorId: string | null = null): void {
  if (Array.isArray(output)) {
    for (const item of output) collectSources(item, into, vendorId);
    return;
  }
  if (typeof output !== "object" || output === null) return;
  const o = output as Record<string, unknown>;
  const vendor = typeof o.vendorId === "string" ? o.vendorId : vendorId;

  if (typeof o.citation === "string" && typeof o.clauseId === "string" && vendor) {
    const page = typeof o.page === "number" ? o.page : Number(PAGE.exec(o.citation)?.[1] ?? NaN);
    const known = into.get(o.citation);
    into.set(o.citation, {
      label: o.citation,
      vendorId: vendor,
      clauseId: o.clauseId,
      page: Number.isFinite(page) ? page : null,
      text: typeof o.text === "string" ? o.text : (known?.text ?? null),
    });
  }
  for (const value of Object.values(o)) if (typeof value === "object" && value !== null) collectSources(value, into, vendor);
}

/**
 * Splits text into plain strings and citations, matching the known labels exactly.
 * Longer labels win, so "Oak contract, page 1" never claims part of "Grand Oak contract, page 12".
 * A citation in parentheses, "(Grand Oak Estate contract, page 2)", becomes the chip alone: the chip is its own bracket.
 */
export function splitCitations(text: string, sources: readonly CitationSource[]): Array<string | CitationSource> {
  if (sources.length === 0 || text.length === 0) return [text];
  const byLabel = new Map(sources.map((s) => [s.label, s]));
  const labels = [...byLabel.keys()].sort((a, b) => b.length - a.length);
  const alternatives = labels.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  // Either "(label)" as a whole, or the bare label not followed by another digit.
  const pattern = new RegExp(`\\(\\s*(${alternatives})\\s*\\)|(${alternatives})(?!\\d)`, "g");

  const parts: Array<string | CitationSource> = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(byLabel.get(match[1] ?? match[2])!);
    last = at + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length > 0 ? parts : [text];
}
