/**
 * Finds each clause in the contract's page text so the viewer can highlight it.
 * Pure and browser-safe. Matching forgives the same typographic differences as
 * quote verification (lib/quotes.ts): case, runs of whitespace and line breaks,
 * curly quotes, dash styles, ligatures, invisible characters, and a word
 * hyphenated across a line break. The returned ranges index the original text,
 * so the viewer can show it exactly as the PDF reads.
 */

export type TextRange = { start: number; end: number };

export type ClauseRef = { id: string; text: string; page: number };

/** A run of page text, highlighted when it belongs to a clause. */
export type Segment = { text: string; clauseId: string | null };

export type ContractLayout = {
  /** Page n is `pages[n - 1]`. */
  pages: Segment[][];
  /** Where each located clause was found (1-based page). May differ from the page the clause claims. */
  foundOn: Record<string, number>;
  /** Clauses whose text could not be found on any page. Never dropped: the viewer quotes them. */
  unlocated: ClauseRef[];
};

const INVISIBLE = /[­​-‍⁠﻿]/g;
const SINGLE_QUOTES = /[‘’‚‛′`´]/g;
const DOUBLE_QUOTES = /[“”„‟″]/g;
const DASHES = /[‐-―−﹘﹣－]/g;
const LINE_BREAK_HYPHEN = /-[ \t]*\r?\n[ \t]*/g;
const ELLIPSIS = /\s*(?:\.{3}|…)\s*/;

const fold = (text: string) =>
  text
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(DASHES, "-")
    .toLowerCase();

/** How a hyphen at a line end is read: kept as is, a split word, or a real hyphen. */
type HyphenMode = "plain" | "join" | "hyphen";

/** Normalised text plus, for each normalised character, the original range it came from. */
type Normalised = { text: string; starts: number[]; ends: number[] };

function normalise(source: string, mode: HyphenMode): Normalised {
  // Original indexes to skip, and the line-end hyphens to keep in "hyphen" mode.
  const skip = new Set<number>();
  if (mode !== "plain") {
    for (const m of source.matchAll(LINE_BREAK_HYPHEN)) {
      const from = mode === "hyphen" ? m.index + 1 : m.index;
      for (let i = from; i < m.index + m[0].length; i++) skip.add(i);
    }
  }

  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let i = 0;
  for (const char of source) {
    const at = i;
    i += char.length;
    if (skip.has(at)) continue;
    if (/\s/.test(char)) {
      if (text.length > 0 && !text.endsWith(" ")) {
        text += " ";
        starts.push(at);
        ends.push(at + char.length);
      }
      continue;
    }
    for (const out of fold(char)) {
      text += out;
      starts.push(at);
      ends.push(at + char.length);
    }
  }
  return { text, starts, ends };
}

function quotePieces(quote: string): string[] {
  return fold(quote)
    .split(ELLIPSIS)
    .map((piece) => piece.replace(/\s+/g, " ").trim())
    .filter((piece) => piece.length > 0);
}

/** Every non-overlapping place `pieces` appear in order, as normalised ranges. */
function findAll(haystack: string, pieces: string[]): TextRange[] {
  const found: TextRange[] = [];
  let from = 0;
  for (;;) {
    const first = haystack.indexOf(pieces[0], from);
    if (first < 0) return found;
    let end = first + pieces[0].length;
    let ok = true;
    for (const piece of pieces.slice(1)) {
      const at = haystack.indexOf(piece, end);
      if (at < 0) {
        ok = false;
        break;
      }
      end = at + piece.length;
    }
    if (!ok) return found;
    found.push({ start: first, end });
    from = end;
  }
}

/**
 * Every place `quote` appears in `pageText`, as ranges of the original text,
 * in order. Empty when it is not there.
 */
export function locateAll(pageText: string, quote: string): TextRange[] {
  const pieces = quotePieces(quote);
  if (pieces.length === 0) return [];
  for (const mode of ["plain", "join", "hyphen"] as const) {
    const norm = normalise(pageText, mode);
    const hits = findAll(norm.text, pieces);
    if (hits.length > 0) return hits.map((r) => ({ start: norm.starts[r.start], end: norm.ends[r.end - 1] }));
  }
  return [];
}

/** The first place `quote` appears in `pageText`, or null. */
export function locateQuote(pageText: string, quote: string): TextRange | null {
  return locateAll(pageText, quote)[0] ?? null;
}

const overlaps = (a: TextRange, b: TextRange) => a.start < b.end && b.start < a.end;

/**
 * Lay out a contract for the viewer: each page split into plain and highlighted
 * runs. A clause is looked for on the page it claims first, then on every other
 * page. Two clauses never share text; a clause whose text is already taken uses
 * its next occurrence, or is reported as unlocated.
 */
export function layoutContract(pages: readonly string[], clauses: readonly ClauseRef[]): ContractLayout {
  const ranges: Array<Array<TextRange & { clauseId: string }>> = pages.map(() => []);
  const foundOn: Record<string, number> = {};
  const unlocated: ClauseRef[] = [];

  for (const clause of clauses) {
    const claimed = clause.page - 1;
    const order = [claimed, ...pages.keys()].filter((p, i, all) => p >= 0 && p < pages.length && all.indexOf(p) === i);
    let placed = false;
    for (const p of order) {
      const free = locateAll(pages[p], clause.text).find((r) => !ranges[p].some((taken) => overlaps(taken, r)));
      if (free) {
        ranges[p].push({ ...free, clauseId: clause.id });
        foundOn[clause.id] = p + 1;
        placed = true;
        break;
      }
    }
    if (!placed) unlocated.push(clause);
  }

  const segmented = pages.map((text, p) => {
    const sorted = [...ranges[p]].sort((a, b) => a.start - b.start);
    const segments: Segment[] = [];
    let at = 0;
    for (const r of sorted) {
      if (r.start > at) segments.push({ text: text.slice(at, r.start), clauseId: null });
      segments.push({ text: text.slice(r.start, r.end), clauseId: r.clauseId });
      at = r.end;
    }
    if (at < text.length || segments.length === 0) segments.push({ text: text.slice(at), clauseId: null });
    return segments;
  });

  return { pages: segmented, foundOn, unlocated };
}
