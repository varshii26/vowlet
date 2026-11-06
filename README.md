# Vowlet

Wedding payment coordinator built for the PayPal AI Hackathon. Couples upload vendor contracts, see every payment on a
timeline anchored to the wedding date, and approve payments through PayPal. Claude reads the contracts; payment math
happens in code.

> Work in progress. See the [project board](https://github.com/users/Gurvinder18/projects/1) and
> [`CLAUDE.md`](CLAUDE.md) for the spec and build order. This README grows with each feature.

## Getting started

Requires Node 22.12 or newer (`.node-version` pins 24) and npm.

```bash
npm install                    # also runs `prisma generate`
cp .env.example .env.local     # fill in the secrets you have; see below
npm run db:migrate             # creates the local SQLite database (dev.db)
npm run dev                    # http://localhost:3000
```

On first start the app seeds the demo wedding (Priya & Sam, 14 vendors, 23 payments) if the database is empty.

### Environment variables

Copy `.env.example` to `.env.local`. Never commit `.env.local`.

| Variable | Needed for | Default in `.env.example` |
|---|---|---|
| `DATABASE_URL` | database | `file:./dev.db` |
| `ANTHROPIC_API_KEY` | contract extraction, agent | empty |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | payments | empty |
| `PAYPAL_WEBHOOK_ID` | webhook verification | empty |

PayPal is sandbox only. No real money moves.

### Database

| Command | What it does |
|---|---|
| `npm run db:migrate` | apply migrations, creating `dev.db` if needed |
| `npm run db:seed` | wipe the database and reload the demo data |
| `npm run db:reset` | **destructive:** drop the database and re-apply migrations. The demo reloads on the next app start (or run `db:seed`). Development databases only. |

The demo data lives in `lib/seed/demo-data.ts`.

### Payment timeline

The home page (`/`) shows every payment on a [Bryntum Gantt Community](https://bryntum.com/products/gantt/) timeline
(MIT licensed, so there is no trial key to expire).

- One row per vendor, each payment a milestone under it at its due date, and every payment linked to a "Wedding day"
  milestone. Milestones are coloured by status: paid, due soon, overdue, refund requested (plus scheduled, refunded and
  void). Hover a milestone for its amount, due date, status and the contract clause it comes from.
- **The chart never decides a date.** `lib/timeline.ts` turns the database rows into Gantt data using
  `lib/schedule.ts`, and payment tasks are manually scheduled, so Bryntum's scheduling engine cannot move them. The
  dependency lines are visual only.
- **To recolour a milestone, set the task's `eventColor`** (`STATUS_COLOR` in `lib/timeline.ts`). Bryntum builds each
  bar's colour palette on its wrapper element, so a CSS class or variable on the bar itself has no effect. A test
  checks the wrapper gets the right `b-color-*` class, and that every colour name exists in Bryntum's stylesheet.
- The page reads the database on every request (`force-dynamic`) and Bryntum only renders in the browser (loaded with
  `next/dynamic`, SSR off), so a paid payment shows up on the next render and a build never freezes the data.
- Community has no "today" line, so there is none yet.
- Code: `lib/timeline.ts` (pure data), `components/Gantt/` (chart, tooltip, styles), `lib/timeline-data.ts` (query).

### Paying a vendor (PayPal sandbox)

The "Upcoming payments" list under the timeline has a PayPal button for each unpaid payment. **Sandbox only: no real
money moves.** The PayPal popup is the human approval; nothing on the page, and nothing the agent can do, approves for
the couple.

1. The button asks `POST /api/payments/[id]/order` to create a PayPal order with the **vendor as the payee**.
2. The couple approves in the PayPal popup.
3. The button sends the order id to `POST /api/payments/[id]/capture`, which captures it, marks the payment paid
   (`captureId`, `paidAt`) and writes an activity-log entry. The page then refreshes, so the timeline and list update.

Rules enforced on the server (`lib/payments/service.ts`):

- Only the order created for that payment can be captured, and a payment is never paid twice. Repeating a capture
  (double click, retry) is a no-op, and a second, different order is refused.
- A payment is only marked paid when PayPal reports the capture `COMPLETED` **and** the amount matches. A different
  amount is logged and not recorded. A `PENDING` capture stays unpaid until it completes (the webhook, #13).
- Failures come back with a message the couple can read: not approved, declined, not payable, or a PayPal error. PayPal
  debug details never reach the browser, and a failed or cancelled payment leaves the status unchanged.

Browser SDK: `@paypal/react-paypal-js`'s default (v5-style) `PayPalScriptProvider` and `PayPalButtons`, which need only
`NEXT_PUBLIC_PAYPAL_CLIENT_ID`. The package's newer v6 API (`/sdk-v6`) also needs a server-issued client token, so it
was left for later.

**To try a real payment:** the seeded vendors use placeholder emails (`sb-vendorN@business.example.com` in
`lib/seed/demo-data.ts`). PayPal accepts those when an order is created but cannot complete a payment to them. Replace
them with your sandbox **business** account emails, run `npm run db:seed`, then pay as your sandbox **personal**
account.

### Sample contracts

`seed/contracts/*.pdf` holds 14 fictional vendor contracts (2-3 pages each) for the demo. They are committed, so a fresh
clone and the hosted demo need no extra step.

```bash
npm run make-contracts    # regenerate all 14 from lib/seed/demo-data.ts
```

- The PDFs and the seeded `Clause` rows come from the same code (`lib/seed/clauses.ts`), so every clause in the
  database appears word for word in its PDF, on the page the database records. A test checks this with real PDF text
  extraction, and another fails if the committed PDFs go stale. After editing the demo data, rerun the command above.
- The wording varies: three styles for payment, cancellation and date-change clauses.
- The contracts include fixed-date and signing-date payments, tiered cancellation refunds, free date changes with 60+
  days' notice, one contract whose cancellation terms sit on an addendum page (DJ Marlow Sound), and one deliberately
  vague payment clause ("approximately one month before the Event Date", Dapper & Co Tailoring) that extraction
  should flag as low confidence.
- Non-refundable amounts are modeled as a flat fee withheld from the refund (`flatFee` in the cancellation rules).
- Output is byte-for-byte reproducible (fixed dates, standard fonts), so diffs show only real changes.

### Quote verification

Claude quotes the clause behind every fact it extracts; `verifyQuote(pages, quote)` in `lib/quotes.ts` checks that the
quote really appears in the PDF and returns the page it was found on (which may differ from the page the model
claimed). Extraction (#6) treats an unverified quote as confidence 0 and flags it for the user to confirm.

- Forgiven: case, whitespace and line breaks, curly vs straight quotes, dash styles, ligatures, invisible characters,
  and a word hyphenated across a line break.
- **Not** forgiven: any other character. Punctuation inside numbers matters, so `$1,000` does not match `$1000`,
  `$10.00` or the start of `$1,000.50`. A quote cannot start or stop in the middle of a word or number.
- `...` (or `…`) skips text; the pieces must appear in order on one page.
- Quotes shorter than 12 characters never verify, so a stray word cannot match anywhere.
- Limit: a quote that runs across a page break is not found, so quotes should stay within one page.

Page text comes from `extractPdfPages()` in `lib/pdf-text.ts`.

### Due dates

Due dates are never stored. Each payment keeps an anchor (`wedding_date`, `signing_date` or `fixed`) and an offset in
days, and `lib/schedule.ts` computes the date, so moving the wedding date moves every wedding-anchored payment and
nothing else.

- All dates are UTC calendar days, so time zones and daylight saving can't shift a result.
- `getDisplayStatus()` turns a payment's stored status plus its due date into what the UI shows: `paid`,
  `refund_requested`, `refunded`, `void`, `overdue` (due before today), `due_soon` (due today through 14 days out) or
  `scheduled`. "Today" is passed in, which keeps it testable.

### Contract terms math

`lib/terms.ts` computes what a date change costs (`dateChangeCost`) and what a cancellation refunds (`refundOwed`).
The model never does this arithmetic.

- Terms are tiers: the rule with the largest `minNoticeDays` that is at or below the notice given applies. A date
  change is measured from today to the **original** wedding date; a cancellation from the cancellation date to the
  wedding. Notice below zero counts as zero.
- Date-change fee = `feePercent` of the contract total + `flatFee`. Cancellation refund = `refundPercent` of the amount
  **paid**, less `flatFee`, never below zero. Only payments with status `paid` count.
- If the **vendor** cancels, everything paid is owed back with no fees. This is an assumption; a contract that says
  otherwise needs its own rule.
- If no tier applies, the cost or refund is 0 and the row says so, rather than implying the change is free.
- Money is integer cents; percentages round half up (`lib/money.ts`).

### Checks

```bash
npm test          # Vitest (includes a SQLite integration test)
npm run lint
npm run typecheck
npm run build
```

### Troubleshooting

- **"Could not locate the bindings file" (better-sqlite3):** npm blocks dependency install scripts by default, and
  `better-sqlite3` needs its install script to fetch the SQLite binary. It is approved in `package.json` under
  `allowScripts`. If you still see the error, run `npm rebuild better-sqlite3`.
- **Empty or stale demo data:** run `npm run db:seed`.
