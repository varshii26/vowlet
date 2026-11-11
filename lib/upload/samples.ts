/**
 * Seeded contracts anyone can try on the upload page without a PDF of their
 * own. They run through the real extraction, but are review-only: each is
 * already one of the demo's vendors, so saving it would add a duplicate to the
 * shared demo.
 */
export const SAMPLE_CONTRACTS = [
  {
    slug: "dapper-and-co-tailoring",
    vendorName: "Dapper & Co Tailoring",
    shows: "A deliberately vague due date, flagged Please confirm",
  },
  {
    slug: "dj-marlow-sound",
    vendorName: "DJ Marlow Sound",
    shows: "Cancellation terms tucked away in an addendum page",
  },
] as const;

export type SampleSlug = (typeof SAMPLE_CONTRACTS)[number]["slug"];

export const findSample = (slug: string) => SAMPLE_CONTRACTS.find((sample) => sample.slug === slug);

/** Where the browser fetches a sample's PDF. */
export const sampleUrl = (slug: SampleSlug) => `/api/contracts/samples/${slug}`;
