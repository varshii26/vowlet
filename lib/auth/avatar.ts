/** Up to two capital letters for the avatar: from the name when there is one ("Priya & Sam" -> "PS"), else the email. */
export function initialsFor(name: string | null | undefined, email: string | null | undefined): string {
  const words = (name ?? "")
    .split(/[\s&+,]+/)
    .map((w) => Array.from(w).find((ch) => /\p{L}|\p{N}/u.test(ch)))
    .filter((ch): ch is string => Boolean(ch));
  if (words.length >= 2) return (words[0] + words[1]).toUpperCase();
  if (words.length === 1) {
    // One word: its first two letters, so "Madonna" is "MA", not just "M".
    const letters = Array.from((name ?? "").replace(/[^\p{L}\p{N}]/gu, ""));
    return letters.slice(0, 2).join("").toUpperCase();
  }
  const local = (email ?? "").split("@")[0].replace(/[^\p{L}\p{N}]/gu, "");
  return Array.from(local).slice(0, 2).join("").toUpperCase() || "?";
}
