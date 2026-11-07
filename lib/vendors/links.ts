/** Links into the vendor page. Plain strings, safe to use in the browser. */

/** The vendor page, opened at one clause when `clauseId` is given. */
export function clauseHref(vendorId: string, clauseId?: string | null): string {
  const base = `/vendors/${encodeURIComponent(vendorId)}`;
  return clauseId ? `${base}?clause=${encodeURIComponent(clauseId)}` : base;
}

/** The vendor's original contract PDF. */
export function contractPdfHref(vendorId: string): string {
  return `/api/vendors/${encodeURIComponent(vendorId)}/contract`;
}

/** DOM id of a clause's highlight in the contract viewer. */
export function clauseDomId(clauseId: string): string {
  return `clause-${clauseId}`;
}
