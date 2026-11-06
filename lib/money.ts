/**
 * Money helpers. All amounts are integer cents; floats never hold money.
 */

/** `$3,000` for whole dollars, `$1,500.50` otherwise. */
export function formatCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = abs % 100 === 0;
  const text = (abs / 100).toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
  return `${negative ? "-" : ""}$${text}`;
}

/** `percent`% of `cents`, rounded half up to a whole cent. */
export function percentOf(cents: number, percent: number): number {
  return Math.floor((cents * percent) / 100 + 0.5);
}
