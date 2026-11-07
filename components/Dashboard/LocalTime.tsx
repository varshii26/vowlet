"use client";

/**
 * A timestamp in the reader's own time zone. The server renders it in UTC and the
 * browser re-renders it locally, so the first paint may differ for a moment; that
 * difference is expected, hence suppressHydrationWarning.
 */
export function LocalTime({ iso, className }: { iso: string; className?: string }) {
  const date = new Date(iso);
  const text = date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {text}
    </time>
  );
}
