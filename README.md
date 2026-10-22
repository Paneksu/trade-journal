# trade-journal

[![CI](https://github.com/Paneksu/trade-journal/actions/workflows/ci.yml/badge.svg)](https://github.com/Paneksu/trade-journal/actions/workflows/ci.yml)

A single-user journal for futures trading, with a backtesting section and statistics measured in R. I built it for myself and use it every trading day. It runs at [dziennik.panekweb.pl](https://dziennik.panekweb.pl), behind a login, so the code in this repository is the part you can actually look at. The interface is in Polish.

Stack: Next.js 16 (App Router), React 19, TypeScript, Drizzle ORM, PostgreSQL 17/18, Docker, Coolify on Hetzner. Tests: Vitest, Playwright, axe-core.

## Features

- **Journal.** Fast trade entry with the result computed live as you type, chart screenshots before and after, a strategy checklist and a note for the day.
- **Calendar.** A month as a map of results, including days you skipped on purpose (with the reason) and journal coverage: how many trading days have any entry at all. A chart screenshot can be pasted into a day with Ctrl+V, even on a day without trades.
- **Backtesting.** Separate sessions with their own assumptions, a sample counter, days without a signal, and a comparison between simulated and live trades of the same strategy.
- **Statistics.** Expected value in R and in cash, profit factor, drawdown, R distribution, MAE/MFE, and a breakdown by any dimension (instrument, session, weekday, tag, custom field).
- **Edge Finder.** Points out contexts where results differ from the average and shows the sample size next to each one.
- **Discipline meter.** Trades without a stop, broken personal rules, sizing up after a loss, re-entries right after a loss.
- **Custom fields.** You define the columns that describe a trade and their value lists. A new field shows up in the form, the table, the filters and the statistics straight away.
- **API for tools.** Device login with a code, scoped tokens, and an import endpoint used by my local CLI to send trades from TradingView and FX Replay.

## Security design

The app holds financial data and accepts writes from tokens, and since October 2026 the only thing between it and the internet is authentication. I wrote that layer without an auth library, using `node:crypto`.

- **Passwords.** scrypt with N = 2^16, a random salt, NFKC normalisation and constant-time comparison: [`src/lib/auth/password.ts`](src/lib/auth/password.ts).
- **Sessions.** An HMAC-signed cookie with a session version, so "log out other browsers" invalidates every older cookie. In production the cookie is always `Secure` and `SameSite=Strict`: [`src/lib/auth/session.ts`](src/lib/auth/session.ts), [`src/lib/auth/token.ts`](src/lib/auth/token.ts).
- **Brute-force limit.** Eight failed password or code attempts from one address lock it out for ten minutes: [`src/lib/auth/guard.ts`](src/lib/auth/guard.ts).
- **TOTP 2FA.** The TOTP secret is stored encrypted with AES-256-GCM. The key comes from `TOTP_ENC_KEY`, or is derived from `SESSION_SECRET` with HKDF when that variable is missing. Codes cannot be replayed within the same time step, backup codes are single use, and sensitive settings require a fresh second factor ("sudo mode"): [`src/lib/auth/totp.ts`](src/lib/auth/totp.ts), [`src/lib/auth/second-factor.ts`](src/lib/auth/second-factor.ts), ADR-031.
- **API tokens.** Device tokens have scopes (`read`, `write`, `propose`, `import`, `import_broker`). Only a SHA-256 hash of each token is stored and comparison is constant time. Approving a new device and creating an import token both require 2FA to be on: [`src/lib/api-v2/scopes.ts`](src/lib/api-v2/scopes.ts), [`src/lib/api-v2/token.ts`](src/lib/api-v2/token.ts), [`src/lib/api-v2/logowanie-urzadzen.ts`](src/lib/api-v2/logowanie-urzadzen.ts), ADR-030.
- **Rate limiting and input.** 120 requests per minute per client, schema validation of every body, idempotent imports: [`src/lib/api-v2/limiter.ts`](src/lib/api-v2/limiter.ts), [`src/lib/api-v2/walidacja.ts`](src/lib/api-v2/walidacja.ts), [`src/lib/ingest/`](src/lib/ingest).
- **Broker account numbers.** Imported files contain account numbers. The database keeps only an HMAC-SHA256 hash and the last four characters: [`src/lib/brokerzy/klucz.ts`](src/lib/brokerzy/klucz.ts), ADR-034.
- **Headers.** CSP with a per-request nonce and `strict-dynamic`, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, and HSTS for one year: [`src/lib/csp.ts`](src/lib/csp.ts), [`src/proxy.ts`](src/proxy.ts), [`next.config.ts`](next.config.ts).
- **Tests.** Browser tests for login, lockout and CSP: [`e2e/bezpieczenstwo.spec.ts`](e2e/bezpieczenstwo.spec.ts), [`e2e/csp.spec.ts`](e2e/csp.spec.ts).

Threat model in short: the attacker is anyone on the internet trying to get into one owner's account, or someone holding a stolen device token. What needs protecting is the trading data, the screenshots and the tokens that can write to the journal. Some things are left out on purpose. HSTS has no `includeSubDomains`, because other subdomains of panekweb.pl are separate apps. The lockout counters live in process memory, which is enough for one container and one user, and a restart clears them.

## Architecture

```
src/
  app/            screens (Next.js App Router), API routes, health probe
  components/     UI: table, forms, charts, calendar
  lib/
    domain/       PURE calculations: trade result, statistics, Edge Finder, discipline
    db/           Drizzle schema, migrations, seed data
    queries/      queries and filters (URL -> SQL conditions)
    actions/      server actions (writes)
    fields/       custom fields: definitions, validation, formatting
    auth/         passwords, sessions, TOTP, lockout
    api-v2/       token API for devices and tools
drizzle/          SQL migrations
e2e/              browser tests and accessibility audit
```

The whole thing rests on one rule: **`lib/domain` knows nothing about the database or Next.js**. The same module computes the live preview in the browser and the result saved on the server, so the two numbers cannot drift apart. Computed columns in the `trades` table only store what those functions return.

Every technical decision is written down with a date and its reasoning, 36 ADRs so far, in [docs/decyzje.md](docs/decyzje.md) (in Polish).

## Running locally

Requirements: Node 22 and Docker (or your own PostgreSQL 17 or 18).

```bash
# 1. Database
docker run -d --name tj-postgres \
  -e POSTGRES_USER=journal -e POSTGRES_PASSWORD=journal -e POSTGRES_DB=journal \
  -p 55432:5432 postgres:18-alpine

# 2. Environment
cp .env.example .env
# set DATABASE_URL=postgresql://journal:journal@localhost:55432/journal,
# SESSION_SECRET (openssl rand -base64 48) and OWNER_PASSWORD

# 3. Dependencies, schema, seed data
npm install
npm run db:migrate
npm run seed

# 4. Start
npm run dev                # http://localhost:3000
```

`npm run seed` sets the password from `OWNER_PASSWORD` and creates a starting account, a catalogue of 23 futures contracts, tag categories and sample custom fields. It is idempotent. Demo data for working on the UI (local only): `npx tsx scripts/demo-data.ts 140`.

| Command | What it does |
|---|---|
| `npm run dev` | development server |
| `npm run build` / `npm start` | production build and server |
| `npm test` | unit tests (Vitest); tests that need a database are skipped |
| `npm run test:db` | the same suite plus the database tests, on a local `tj_*` database only |
| `npm run test:e2e` | browser tests and accessibility audit (Playwright + axe), local database only |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:migrate` | apply migrations |

## Quality

CI runs typecheck, lint and the unit tests on every push. The database and browser tests run locally, against a throwaway database, because they write data.

| Check | Result |
|---|---|
| Unit tests (no database) | about 900, run in CI |
| Database tests | about 400, local PostgreSQL |
| E2E | about 140 Playwright tests |
| Accessibility (axe, WCAG 2.2 AA) | 11 screens in a loop plus 6 detailed states, no violations |
| Lighthouse desktop | performance 100, accessibility 100, best practices 100 |
| Lighthouse mobile | performance 92, accessibility 100, best practices 100 |
| Lighthouse SEO | 60 on purpose: the app is `noindex` |

## How this was built

I wrote this with Claude Code, which is why most commits carry `Co-Authored-By: Claude`. I set the data model, the architecture and the security design, reviewed the changes, and wrote the decisions down as ADRs. A change was done when tests and review passed, and releases also went through a security audit.

## License

No open source license. All rights reserved; the source is public so it can be read and reviewed.
