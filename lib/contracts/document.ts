import { formatCents } from "@/lib/money";
import { BILLING_NOTES_INTRO, SCHEDULE_PAGE_CATEGORIES, buildVendorClauses, vendorStyle, type Style } from "@/lib/seed/clauses";
import { VENDORS, WEDDING, vendorTotalCents, type VendorSpec } from "@/lib/seed/demo-data";

/**
 * The text of a vendor contract as a list of pages of blocks. Pure data: the
 * PDF renderer turns it into a file and the tests read it directly.
 */

export type Block =
  | { type: "title"; text: string }
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "bullet"; text: string }
  /** Small grey print, easy to miss on paper (the prompt-injection showcase). */
  | { type: "fineprint"; text: string }
  | { type: "signature" };

export type ContractDocument = {
  slug: string;
  title: string;
  /** Page n of the contract is `pages[n - 1]`. */
  pages: Block[][];
};

const CATEGORY: Record<string, { title: string; services: string; schedule: string[] }> = {
  venue: {
    title: "Venue Rental Agreement",
    services:
      "The Company will provide exclusive use of the estate grounds, ceremony lawn, reception hall and bridal suite for the Event Date, including tables, chairs and on-site coordination.",
    schedule: ["Access from 10:00 AM to midnight", "Ceremony lawn and reception hall", "Bridal suite and groom's lounge", "On-site venue coordinator"],
  },
  caterer: {
    title: "Catering Services Agreement",
    services:
      "The Company will prepare and serve a plated dinner, cocktail hour canapes and late-night snacks for the guest count confirmed by the Client, with service staff and bar support.",
    schedule: ["Cocktail hour canapes", "Three-course plated dinner", "Late-night snack station", "Service staff and bartenders"],
  },
  photographer: {
    title: "Photography Services Agreement",
    services:
      "The Company will provide eight hours of coverage by two photographers on the Event Date and deliver an edited online gallery of at least 500 images.",
    schedule: ["Eight hours of coverage", "Second photographer", "Edited online gallery", "Print release for family use"],
  },
  florist: {
    title: "Floral Design Agreement",
    services: "The Company will design and deliver the bridal bouquet, ceremony arch arrangements, and reception centerpieces agreed with the Client.",
    schedule: ["Bridal bouquet", "Ceremony arch", "Reception centerpieces", "Delivery and setup"],
  },
  music: {
    title: "Live Music Agreement",
    services: "The Company will perform a string quartet program for the ceremony and cocktail hour on the Event Date.",
    schedule: ["Ceremony processional", "Cocktail hour set", "Sound check", "Travel included"],
  },
  dj: {
    title: "DJ and Sound Agreement",
    services: "The Company will provide a DJ, sound system and microphones for the reception, with an agreed playlist and announcements.",
    schedule: ["Five hours of music", "Sound system and microphones", "Agreed playlist", "Setup and teardown"],
  },
  cake: {
    title: "Wedding Cake Agreement",
    services: "The Company will bake, deliver and set up a three-tier wedding cake with the flavors and design agreed with the Client.",
    schedule: ["Three-tier cake", "Agreed flavors", "Delivery and setup", "Cake stand loan"],
  },
  attire: {
    title: "Attire and Fittings Agreement",
    services: "The Company will supply, tailor and fit the wedding attire agreed with the Client, including up to three fittings.",
    schedule: ["Garment supply", "Up to three fittings", "Final pressing", "Garment bag"],
  },
  beauty: {
    title: "Hair and Makeup Agreement",
    services: "The Company will provide hair styling and makeup for the Client on the morning of the Event Date, including a trial session.",
    schedule: ["Trial session", "Morning-of styling", "Touch-up kit", "On-location service"],
  },
  transport: {
    title: "Transportation Agreement",
    services: "The Company will provide a chauffeured vehicle to carry the couple between the ceremony and reception on the Event Date.",
    schedule: ["Chauffeured vehicle", "Ceremony to reception transfer", "Four hours of service", "Fuel included"],
  },
  stationery: {
    title: "Invitation Design Agreement",
    services: "The Company will design, print and deliver the wedding invitations and reply cards agreed with the Client.",
    schedule: ["Invitation design", "Printing and envelopes", "Reply cards", "Delivery to the Client"],
  },
  decor: {
    title: "Lighting and Decor Agreement",
    services: "The Company will install string lighting, uplighting and decor pieces at the reception venue on the Event Date.",
    schedule: ["String lighting", "Uplighting", "Decor pieces", "Install and removal"],
  },
  officiant: {
    title: "Officiant Services Agreement",
    services: "The Company will officiate the wedding ceremony on the Event Date and meet with the Client once beforehand to plan the ceremony.",
    schedule: ["Pre-ceremony meeting", "Ceremony script", "Officiating on the day", "Marriage license filing"],
  },
};

const GENERAL_TERMS = [
  "The Company will carry appropriate insurance. Neither party is liable for failure to perform caused by events beyond its reasonable control. This Agreement is governed by the laws of the State of Oregon.",
  "Each party shall act in good faith. Neither party is responsible for delays caused by weather, illness or other circumstances outside its control. Any dispute will be settled under the laws of the State of Oregon.",
  "This is the entire agreement between the parties and replaces any earlier discussions. Changes must be in writing and signed by both parties. Oregon law applies.",
];

/** Contracts with a third page of service details that contains no terms. */

const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

function intro(spec: VendorSpec, style: Style): string {
  const signed = longDate(spec.signingDate);
  const event = longDate(WEDDING.date);
  return [
    `This Agreement is made on ${signed} between ${spec.name} (the "Company") and ${WEDDING.coupleNames} (the "Client") for services at the wedding to be held on ${event} (the "Event Date").`,
    `${spec.name} (the "Company") agrees to provide the services described below to ${WEDDING.coupleNames} (the "Client") for the wedding on ${event} (the "Event Date"). Signed ${signed}.`,
    `Agreement dated ${signed}. Parties: ${WEDDING.coupleNames} (the "Client") and ${spec.name} (the "Company"). Event Date: ${event}.`,
  ][style];
}

export function buildContractDocument(spec: VendorSpec, style: Style): ContractDocument {
  const info = CATEGORY[spec.category];
  if (!info) throw new Error(`No contract template for category "${spec.category}"`);
  const clauses = buildVendorClauses(spec, style);
  const cancelOnAddendum = clauses.cancellation.page === 3;

  const page1: Block[] = [
    { type: "title", text: info.title },
    { type: "paragraph", text: intro(spec, style) },
    { type: "heading", text: "1. Services" },
    { type: "paragraph", text: info.services },
    { type: "heading", text: "2. Fees and Payment" },
    { type: "paragraph", text: `Total contract price: ${formatCents(vendorTotalCents(spec))}.` },
    ...clauses.payments.map((c, i): Block => ({ type: "paragraph", text: `2.${i + 1} ${c.text}` })),
  ];

  const page2: Block[] = [
    { type: "heading", text: "3. Cancellation" },
    {
      type: "paragraph",
      text: cancelOnAddendum
        ? "The Company's cancellation and refund terms are set out in Addendum A, which forms part of this Agreement."
        : clauses.cancellation.text,
    },
    { type: "heading", text: "4. Changes to the Event Date" },
    { type: "paragraph", text: clauses.dateChange.text },
    { type: "heading", text: "5. General Terms" },
    { type: "paragraph", text: GENERAL_TERMS[style] },
    { type: "signature" },
  ];

  const pages = [page1, page2];
  if (cancelOnAddendum) {
    pages.push([
      { type: "heading", text: "Addendum A: Cancellation Terms" },
      { type: "paragraph", text: clauses.cancellation.text },
    ]);
  } else if (SCHEDULE_PAGE_CATEGORIES.has(spec.category)) {
    pages.push([
      { type: "heading", text: "Schedule A: Service Details" },
      ...info.schedule.map((item): Block => ({ type: "bullet", text: item })),
    ]);
  }

  if (spec.hiddenInstruction) {
    pages.push([
      { type: "heading", text: `Addendum ${cancelOnAddendum ? "B" : "A"}: Billing Notes` },
      { type: "paragraph", text: BILLING_NOTES_INTRO },
      { type: "fineprint", text: spec.hiddenInstruction },
    ]);
  }

  return { slug: spec.slug, title: info.title, pages };
}

/** Documents for the whole demo, in vendor order. */
export function buildAllContracts(vendors: readonly VendorSpec[] = VENDORS): ContractDocument[] {
  return vendors.map((spec) => buildContractDocument(spec, vendorStyle(spec, vendors)));
}
