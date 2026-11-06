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

/** `150050` -> `"1500.50"`: the decimal string PayPal expects, built without floats. */
export function centsToDecimalString(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error(`Expected non-negative integer cents, got ${cents}`);
  }
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** `"1500.50"` -> `150050`. Rejects anything that isn't a plain amount with at most 2 decimals. */
export function decimalStringToCents(value: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new Error(`Not a decimal amount: ${value}`);
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}
