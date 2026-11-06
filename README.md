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
| `PAYPAL_API_BASE` | PayPal sandbox calls | `https://api-m.sandbox.paypal.com` |
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

The demo data lives in `lib/seed/demo-data.ts`. Due dates are never stored: each payment keeps an anchor and an offset,
so moving the wedding date moves every payment.

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
