import type { CancellationRule, DateChangeRule } from "@/lib/rules";

/**
 * Single source of truth for the Priya & Sam demo. The seed writes it to the
 * database and scripts/make-contracts.ts will render the same numbers into
 * PDFs. All money is integer cents.
 */

export const WEDDING = {
  coupleNames: "Priya & Sam",
  date: "2027-04-17",
  budgetCents: 3_600_000,
} as const;

export type PaymentSpec = {
  label: string;
  amountCents: number;
  anchor: "wedding_date" | "signing_date" | "fixed";
  offsetDays?: number; // days from the anchor; negative = before
  fixedDate?: string; // ISO date, only for anchor "fixed"
  /**
   * Deliberately vague contract wording. When set it is the clause text, and
   * the anchor/offset above are the reading the couple confirmed. Extraction
   * should flag it as low confidence.
   */
  ambiguousText?: string;
};

export type VendorSpec = {
  slug: string;
  name: string;
  category: string;
  paypalEmail: string;
  signingDate: string; // ISO date
  payments: PaymentSpec[];
  cancellation: CancellationRule[];
  dateChange: DateChangeRule[];
  /** Page the cancellation clause sits on (default 2). */
  cancellationPage?: number;
  /** True when the cancellation terms are in an addendum, not the main body. */
  cancellationInAddendum?: boolean;
};

const dollars = (n: number) => n * 100;

// Rule presets, varied across vendors.
const CANCEL_TIERED: CancellationRule[] = [
  { minNoticeDays: 180, refundPercent: 75, flatFee: 0 },
  { minNoticeDays: 90, refundPercent: 50, flatFee: 0 },
  { minNoticeDays: 30, refundPercent: 25, flatFee: 0 },
  { minNoticeDays: 0, refundPercent: 0, flatFee: 0 },
];
const CANCEL_STRICT: CancellationRule[] = [
  { minNoticeDays: 90, refundPercent: 50, flatFee: 0 },
  { minNoticeDays: 0, refundPercent: 0, flatFee: 0 },
];
const CANCEL_FLEXIBLE: CancellationRule[] = [
  { minNoticeDays: 60, refundPercent: 100, flatFee: dollars(100) },
  { minNoticeDays: 30, refundPercent: 50, flatFee: dollars(100) },
  { minNoticeDays: 0, refundPercent: 0, flatFee: 0 },
];
const DATE_FREE_60: DateChangeRule[] = [
  { minNoticeDays: 60, feePercent: 0, flatFee: 0 },
  { minNoticeDays: 30, feePercent: 10, flatFee: 0 },
  { minNoticeDays: 0, feePercent: 25, flatFee: 0 },
];
const DATE_FLAT_FEE: DateChangeRule[] = [
  { minNoticeDays: 90, feePercent: 0, flatFee: dollars(150) },
  { minNoticeDays: 0, feePercent: 15, flatFee: dollars(150) },
];
const DATE_STRICT: DateChangeRule[] = [
  { minNoticeDays: 120, feePercent: 5, flatFee: 0 },
  { minNoticeDays: 0, feePercent: 30, flatFee: 0 },
];

// Placeholder payee emails. Replace with the real PayPal sandbox business
// accounts once they exist (see issue #10); five accounts cover 14 vendors.
const email = (n: number) => `sb-vendor${n}@business.example.com`;

export const VENDORS: VendorSpec[] = [
  {
    slug: "grand-oak-estate",
    name: "Grand Oak Estate",
    category: "venue",
    paypalEmail: email(1),
    signingDate: "2026-06-12",
    payments: [
      { label: "Venue deposit", amountCents: dollars(3000), anchor: "signing_date" },
      { label: "Venue second installment", amountCents: dollars(3000), anchor: "wedding_date", offsetDays: -120 },
      { label: "Venue final balance", amountCents: dollars(3000), anchor: "wedding_date", offsetDays: -30 },
    ],
    cancellation: CANCEL_STRICT,
    dateChange: DATE_STRICT,
  },
  {
    slug: "saffron-and-sage-catering",
    name: "Saffron & Sage Catering",
    category: "caterer",
    paypalEmail: email(2),
    signingDate: "2026-07-03",
    payments: [
      { label: "Catering deposit", amountCents: dollars(1500), anchor: "signing_date" },
      { label: "Catering second installment", amountCents: dollars(3000), anchor: "wedding_date", offsetDays: -60 },
      { label: "Catering final balance", amountCents: dollars(1500), anchor: "wedding_date", offsetDays: -7 },
    ],
    cancellation: CANCEL_TIERED,
    dateChange: DATE_FREE_60,
  },
  {
    slug: "lumen-photography",
    name: "Lumen Photography",
    category: "photographer",
    paypalEmail: email(3),
    signingDate: "2026-07-21",
    payments: [
      { label: "Photography retainer", amountCents: dollars(1000), anchor: "signing_date" },
      { label: "Photography balance", amountCents: dollars(2200), anchor: "wedding_date", offsetDays: -30 },
    ],
    cancellation: CANCEL_TIERED,
    dateChange: DATE_FREE_60,
  },
  {
    slug: "bloom-and-thistle-florals",
    name: "Bloom & Thistle Florals",
    category: "florist",
    paypalEmail: email(4),
    signingDate: "2026-08-05",
    payments: [
      { label: "Floral deposit", amountCents: dollars(800), anchor: "signing_date" },
      { label: "Floral final balance", amountCents: dollars(1600), anchor: "wedding_date", offsetDays: -14 },
    ],
    cancellation: CANCEL_FLEXIBLE,
    dateChange: DATE_FLAT_FEE,
  },
  {
    slug: "velvet-strings-quartet",
    name: "Velvet Strings Quartet",
    category: "music",
    paypalEmail: email(5),
    signingDate: "2026-08-14",
    payments: [{ label: "Quartet full payment", amountCents: dollars(1400), anchor: "wedding_date", offsetDays: -7 }],
    cancellation: CANCEL_STRICT,
    dateChange: DATE_FLAT_FEE,
  },
  {
    slug: "dj-marlow-sound",
    name: "DJ Marlow Sound",
    category: "dj",
    paypalEmail: email(1),
    signingDate: "2026-08-22",
    payments: [
      { label: "DJ booking fee", amountCents: dollars(500), anchor: "fixed", fixedDate: "2026-12-01" },
      { label: "DJ final balance", amountCents: dollars(1000), anchor: "wedding_date", offsetDays: -7 },
    ],
    cancellation: CANCEL_TIERED,
    dateChange: DATE_FREE_60,
    // Cancellation terms live on an addendum page, to exercise extraction.
    cancellationPage: 3,
    cancellationInAddendum: true,
  },
  {
    slug: "sweet-layers-bakery",
    name: "Sweet Layers Bakery",
    category: "cake",
    paypalEmail: email(2),
    signingDate: "2026-09-02",
    payments: [{ label: "Wedding cake full payment", amountCents: dollars(800), anchor: "wedding_date", offsetDays: -10 }],
    cancellation: CANCEL_FLEXIBLE,
    dateChange: DATE_FLAT_FEE,
  },
  {
    slug: "maison-eclat-bridal",
    name: "Maison Éclat Bridal",
    category: "attire",
    paypalEmail: email(3),
    signingDate: "2026-06-28",
    payments: [
      { label: "Gown deposit", amountCents: dollars(1000), anchor: "signing_date" },
      { label: "Gown final balance", amountCents: dollars(1000), anchor: "wedding_date", offsetDays: -60 },
    ],
    cancellation: CANCEL_STRICT,
    dateChange: DATE_STRICT,
  },
  {
    slug: "dapper-and-co-tailoring",
    name: "Dapper & Co Tailoring",
    category: "attire",
    paypalEmail: email(4),
    signingDate: "2026-09-10",
    payments: [
      {
        label: "Suit full payment",
        amountCents: dollars(1100),
        anchor: "wedding_date",
        offsetDays: -30,
        // The one deliberately ambiguous clause: "approximately one month".
        ambiguousText: "The balance of $1,100 (Suit full payment) is due approximately one month before the Event Date.",
      },
    ],
    cancellation: CANCEL_TIERED,
    dateChange: DATE_FREE_60,
  },
  {
    slug: "glow-hair-and-makeup",
    name: "Glow Hair & Makeup",
    category: "beauty",
    paypalEmail: email(5),
    signingDate: "2026-09-18",
    payments: [{ label: "Hair & makeup full payment", amountCents: dollars(700), anchor: "wedding_date", offsetDays: -1 }],
    cancellation: CANCEL_FLEXIBLE,
    dateChange: DATE_FLAT_FEE,
  },
  {
    slug: "evergreen-transport",
    name: "Evergreen Transport",
    category: "transport",
    paypalEmail: email(1),
    signingDate: "2026-09-25",
    payments: [{ label: "Transport full payment", amountCents: dollars(900), anchor: "wedding_date", offsetDays: -3 }],
    cancellation: CANCEL_TIERED,
    dateChange: DATE_FREE_60,
  },
  {
    slug: "paper-crane-invitations",
    name: "Paper Crane Invitations",
    category: "stationery",
    paypalEmail: email(2),
    signingDate: "2026-10-01",
    payments: [{ label: "Invitations full payment", amountCents: dollars(600), anchor: "signing_date" }],
    cancellation: CANCEL_STRICT,
    dateChange: DATE_STRICT,
  },
  {
    slug: "starlight-lighting-and-decor",
    name: "Starlight Lighting & Decor",
    category: "decor",
    paypalEmail: email(3),
    signingDate: "2026-10-09",
    payments: [
      { label: "Lighting deposit", amountCents: dollars(500), anchor: "signing_date" },
      { label: "Lighting final balance", amountCents: dollars(500), anchor: "wedding_date", offsetDays: -21 },
    ],
    cancellation: CANCEL_TIERED,
    dateChange: DATE_FLAT_FEE,
  },
  {
    slug: "harbor-officiants",
    name: "Harbor Officiants",
    category: "officiant",
    paypalEmail: email(4),
    signingDate: "2026-10-15",
    payments: [{ label: "Officiant full payment", amountCents: dollars(400), anchor: "wedding_date", offsetDays: -14 }],
    cancellation: CANCEL_FLEXIBLE,
    dateChange: DATE_FREE_60,
  },
];

export const vendorTotalCents = (v: VendorSpec) => v.payments.reduce((sum, p) => sum + p.amountCents, 0);
