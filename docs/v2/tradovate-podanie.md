# Podanie do NinjaTrader Ecosystem i pytania do Tradovate (ADR-034, etap B)

**Status:** szkic do wysłania przez użytkownika (2026-10-16). Nic nie zostało wysłane.

**Jak użyć.**
1. Uzupełnij pola w nawiasach kwadratowych (`[...]`). W tekście nie ma danych osobowych, bo wpisujesz je sam.
2. Kanał: formularz partnera NinjaTrader Ecosystem albo e-mail do wsparcia API Tradovate. Dokładnego adresu
   formularza research nie potwierdził (LUKA). Punkt wyjścia: `https://docs.ninjatrader.com/api/oauth`.
3. Odpowiedź zapisz w `docs/v2/` jako plik z datą. Bez **pisemnej** odpowiedzi na pytania 1–3 flaga
   OAuth zostaje wyłączona (ADR-034, pkt 1 i 5).
4. Nie podawaj w podaniu numerów kont, loginów ani zrzutów z platformy.

---

## Subject: API access request: read-only OAuth for a personal, single-user trading journal

Hello,

I am an individual developer and an active futures trader using Tradovate, including evaluation and
funded accounts provided by prop firms that clear through Tradovate. I would like to apply for OAuth
access for a personal trading journal application and ask a few questions before building the integration.

### About the application

- **Name:** [APP NAME]
- **Operator:** [YOUR NAME / COMPANY, or "individual"]
- **Contact e-mail:** [EMAIL]
- **Users:** one user only, the account owner (me). The application is not offered to other people and is
  not a commercial product. [Adjust if this changes.]
- **Purpose:** a trading journal. After the trading session it reads my own fills, orders, positions and
  cash balance so that I can review my trades, compare them with my notes and analyse my results.
- **Redirect URI:** `https://[APP_DOMAIN]/[CALLBACK_PATH]` (HTTPS only).
- **Hosting:** a private server in the EU, behind HTTPS, with two-factor authentication for the only user.

### What the application will never do

- It will never place, modify or cancel orders, liquidate positions, start order strategies or change any
  account or risk setting. It does not act on my behalf in any way.
- It will never ask for, receive or store my Tradovate password. Authorisation happens only in the official
  Tradovate OAuth window.
- It does not use market data or WebSocket market data feeds, and it does not redistribute any data.

### Planned API usage (read-only)

REST only, a few requests per sync, outside my trading hours:

- `GET /account/list`, `GET /auth/me`
- `GET /fill/list`, `GET /fillPair/list`, `GET /fillFee/list`
- `GET /order/list`, `GET /position/list`
- `GET /cashBalance/getcashbalancesnapshot`
- `GET /contract/item` (symbol and contract details)
- token exchange and renewal endpoints only

The client enforces an allow-list of these paths and HTTP methods. Any other request is rejected inside the
application before it is sent. Tokens are encrypted at rest with a key stored outside the database, never
logged and never sent to the browser. The data-fetching process runs separately from the web application,
and its outbound network traffic is limited to Tradovate hosts.

### Questions

1. **Read-only scopes.** Which OAuth scopes are available to third-party applications, and what are their
   exact names? Can an application be restricted to read-only access (accounts, fills, orders, positions,
   cash balance, contracts), so that a token issued to it **cannot** place, modify or cancel orders or
   liquidate positions? If such a restriction exists, would a token rejected for a write request return an
   error (for example 401 or 403)? Are permission levels (Denied / Read / Full) shown to the user in the consent
   window? We would like a written confirmation of this before enabling the integration.
2. **Caching and retention (API License Agreement, section 3).** Does the 24-hour cache requirement for
   "NinjaTrader Content" apply to the user's **own** account data (their own fills, orders, positions and cash
   balance) retrieved with their consent for their own journal? If it does, may the application keep a
   permanent record that the user creates from that data, such as one row per completed trade with its
   realised P&L? Does the requirement apply to files that the user exports manually from the Tradovate
   platform (for example the Performance or Fills CSV)?
3. **Concurrent sessions.** The documentation mentions a limit of two concurrent sessions per user, with a
   third session closing the oldest one. Does a session created with an OAuth access token by a third-party
   application count towards this limit? Can a read-only request from the application log the user out of
   the Tradovate web, desktop or mobile platform during trading?
4. **Prop firm accounts.** Does OAuth work for evaluation and funded (simulated) accounts provided by prop
   firms that clear through Tradovate (for example Apex Trader Funding, Tradeify, Lucid Trading,
   MyFundedFutures, Take Profit Trader, Earn2Trade)? Are there any extra conditions for these accounts?
5. **Account phase.** Is there an endpoint or a field that tells whether an account is an evaluation account
   or a funded account (for example the meaning of `hasFunded` and `hasLive`)?
6. **Tokens.** What are the access token and refresh token lifetimes (and the unit of
   `refresh_token_expires_in`)? Is PKCE supported (`code_verifier`)? Is there an endpoint to revoke a token
   or the application's authorisation, or should the user revoke it in the Tradovate settings? Which host
   should be used for the token exchange (`live.tradovateapi.com` or `live-api-d.tradovate.com`)?
7. **Commissions and fees.** Is `/fillFee/list` available to OAuth applications? The journal records results
   net of all fees, so per-fill commissions and exchange fees matter.
7a. **Fill history under OAuth.** Do `/fill/list` and `/order/list` return historical fills (previous sessions)
   for an OAuth token, or only the current session? Developers on the community forum report empty arrays for these
   endpoints under OAuth while `/position/list` works. If history requires the Reporting API, does it accept an
   OAuth access token?
8. **Rate limits.** Which limits apply to OAuth applications (per user, per application, per IP)?
9. **Costs and process.** Are there any fees for Ecosystem approval or for read-only API access? How long
   does the review usually take, and is a demo environment (`trader.devel.ninjatrader.dev`) available for
   testing before approval?
10. **Permitted use.** Is a personal, single-user, read-only journal an acceptable use case under the API
    License Agreement?

Thank you for your time. I am happy to provide more technical details or a short description of the
security measures if that helps the review.

Kind regards,
[YOUR NAME]
[EMAIL]
