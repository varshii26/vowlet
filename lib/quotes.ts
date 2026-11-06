/**
 * Quote verification. Claude quotes the clause behind each fact it extracts;
 * this checks that the quote really appears in the PDF and says which page.
 * An unverified quote must not be trusted.
 *
 * Forgiven (typographic only): case, runs of whitespace and line breaks, curly
 * vs straight quotes, dash styles, ligatures and other compatibility forms,
 * invisible characters, and a word hyphenated across a line break.
 *
 * Never forgiven: any other character. Punctuation inside numbers matters,
 * so "$1,000" does not match "$1000" or "$10.00". A wrong amount must fail.
 *
 * A quote may use "..." (or an ellipsis character) to skip text; the pieces
 * must then appear in order on one page. A quote that runs across a page break
 * is not found; quote within a page.
 */

/** Shortest quote (after normalising) that can verify. Stops "the" matching everywhere. */
export const MIN_QUOTE_LENGTH = 12;

export type QuoteCheck =
  | { verified: true; page: number }
  | { verified: false; page: null; reason: "empty" | "too_short" | "not_found" };

const INVISIBLE = /[­​-‍⁠﻿]/g;
const SINGLE_QUOTES = /[‘’‚‛′`´]/g;
const DOUBLE_QUOTES = /[“”„‟″]/g;
const DASHES = /[‐-―−﹘﹣－]/g;
// A hyphen at the end of a line, then the line break and the next line's indent.
const LINE_BREAK_HYPHEN = /-[ \t]*\r?\n[ \t]*/g;
const ELLIPSIS = /\s*(?:\.{3}|…)\s*/;

/** Unicode and punctuation folding. Keeps line breaks so hyphenation can be seen. */
function fold(text: string): string {
  return text
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(DASHES, "-");
}

const collapse = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The ways a page's text may read once line breaks are undone. A hyphen at a
 * line end is either a split word ("refund-\nable") or a real hyphen
 * ("non-\nrefundable"); we cannot tell, so we try both, plus the plain form.
 */
function pageForms(page: string): string[] {
  const folded = fold(page);
  return [
    collapse(folded),
    collapse(folded.replace(LINE_BREAK_HYPHEN, "")),
    collapse(folded.replace(LINE_BREAK_HYPHEN, "-")),
  ];
}

const WORD_CHAR = /[\p{L}\p{N}]/u;
const DIGIT = /\p{N}/u;

/**
 * A hit only counts if it is not the middle of something longer. "$1,000" must
 * not match inside "$1,000.50" or "$11,000", and "pay $30" must not match
 * "pay $300".
 */
function isWholeMatch(haystack: string, at: number, length: number): boolean {
  const first = haystack[at];
  const last = haystack[at + length - 1];
  const before = haystack[at - 1];
  const after = haystack[at + length];

  if (WORD_CHAR.test(first) && before !== undefined && WORD_CHAR.test(before)) return false;
  if (WORD_CHAR.test(last) && after !== undefined && WORD_CHAR.test(after)) return false;
  // A number that continues after a separator: "1,000" then ".50" or ",500".
  if (DIGIT.test(last) && /^[.,]\p{N}/u.test(haystack.slice(at + length, at + length + 2))) return false;
  // A number that started before a separator: "1," or "3." right before "000".
  if (DIGIT.test(first) && before !== undefined && /[.,]/.test(before) && DIGIT.test(haystack[at - 2] ?? "")) return false;
  return true;
}

/** First whole-word index of `piece` at or after `from`, or -1. */
function findWhole(haystack: string, piece: string, from: number): number {
  let at = haystack.indexOf(piece, from);
  while (at >= 0 && !isWholeMatch(haystack, at, piece.length)) {
    at = haystack.indexOf(piece, at + 1);
  }
  return at;
}

/** True if every piece appears in `haystack`, in order. */
function containsInOrder(haystack: string, pieces: string[]): boolean {
  let from = 0;
  for (const piece of pieces) {
    const at = findWhole(haystack, piece, from);
    if (at < 0) return false;
    from = at + piece.length;
  }
  return true;
}

/**
 * Find `quote` in the PDF. `pages[0]` is page 1. Returns the first page that
 * contains it, which may differ from the page the model claimed.
 */
export function verifyQuote(pages: readonly string[], quote: string): QuoteCheck {
  const pieces = fold(quote)
    .split(ELLIPSIS)
    .map(collapse)
    .filter((piece) => piece.length > 0);

  if (pieces.length === 0) return { verified: false, page: null, reason: "empty" };
  if (pieces.join("").length < MIN_QUOTE_LENGTH) return { verified: false, page: null, reason: "too_short" };

  for (let i = 0; i < pages.length; i++) {
    if (pageForms(pages[i]).some((form) => containsInOrder(form, pieces))) {
      return { verified: true, page: i + 1 };
    }
  }
  return { verified: false, page: null, reason: "not_found" };
}
