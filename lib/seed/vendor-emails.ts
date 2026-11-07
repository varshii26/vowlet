/**
 * Who the demo's vendors are paid as. PayPal needs a real sandbox business
 * account for a payment to complete, so the emails come from the
 * PAYPAL_VENDOR_EMAILS environment variable (a comma-separated list), and the
 * 14 vendors share them in turn. Without it, placeholder addresses are used:
 * orders can still be created for them, but a payment to one can't complete.
 */

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

export type ParsedEmails = { valid: string[]; ignored: string[] };

/** Splits on commas, semicolons, spaces and newlines. Keeps the order, drops duplicates and anything that isn't an email. */
export function parseVendorEmails(value: string | undefined): ParsedEmails {
  const valid: string[] = [];
  const ignored: string[] = [];
  for (const raw of (value ?? "").split(/[\s,;]+/)) {
    const item = raw.trim();
    if (!item) continue;
    if (!EMAIL.test(item)) ignored.push(item);
    else if (!valid.includes(item)) valid.push(item);
  }
  return { valid, ignored };
}

/** The payee for vendor slot `n` (1, 2, 3, ...), cycling through the configured emails. */
export function vendorEmail(n: number, configured: readonly string[]): string {
  if (!Number.isInteger(n) || n < 1) throw new RangeError("n must be a whole number from 1");
  return configured.length > 0 ? configured[(n - 1) % configured.length] : `sb-vendor${n}@business.example.com`;
}
