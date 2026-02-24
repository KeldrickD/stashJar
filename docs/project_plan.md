# Project Plan — StashJar

## Guiding principles
- Server is the source of truth for:
  - what’s due, what’s actionable, caps, actions/limits, and UI mode.
- Normie-safe by default.
- Deterministic + idempotent backends (challenge events, funding refresh, reminders).

## Milestones

### M1 — Core habit loop (DONE)
- Today cards + banner system
- Challenges: temp, weather, dice, envelopes, weekly increment
- Auto-commit and commit-pending sweeper
- Streaks + “All done” state

### M2 — Funding loop (DONE + ongoing hardening)
- Wallet provision abstraction
- Fund session token endpoint (Coinbase)
- Refresh bridge with daily limits + polling UX
- Miniapp open-in-wallet mode + focus/visibility refresh
- FundingSession audit table

### M3 — Push reminders (DONE)
- PushSubscription model
- Reminder job driven by challenge due windows
- Deep links to best target (home vs challenges)
- Service worker navigation to existing tab

### M4 — Security and productionization (ONGOING)
- Auth: magic links + sessions + sliding renewal (DONE)
- Rate limits: IP + per-email + cooldown (DONE)
- Action endpoint per-user rate limits (DONE)
- Health endpoints + ledger integrity checks (DONE)
- Remaining: production hardening + monitoring dashboards

### M5 — Base miniapp packaging (NEXT)
- Host configuration + canonical deeplink contract
- Test matrix across embedded webviews
- UX polish for “open wallet -> return -> credit”

## Workstreams
1) Product/UX: Today, banners, clarity, copy, streak/recovery, weekly recap.
2) Backend correctness: idempotency, caps, windows, integrity checks.
3) Funding: session minting, refresh bridge, rail selection, onchain read reliability.
4) Push/email: reminders and recap.
5) Observability: dashboards, alerting.

## Release checklist
- [ ] Deploy ledger-service with HTTPS + correct CORS credential settings
- [ ] Resend domain verified (SPF/DKIM)
- [ ] VAPID keys set, PUSH_ENABLED=true
- [ ] FUNDING_PROVIDER=coinbase and CDP keys set
- [ ] RPC_URL and USDC_ADDRESS for Base mainnet
- [ ] Run migrations + prisma generate
- [ ] Run full tests: due-window tests + contract tests
