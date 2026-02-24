# Security Model – StashJar

## Goals

- Prevent account takeover
- Prevent userId spoofing
- Prevent funding abuse (free-credit loops, spam sessions, drain attempts)
- Protect privacy (no exposing wallet internals to Normies)
- Keep system safe under retries + flaky webviews

---

## Threat Model (high level)

**Authentication threats** — Magic-link token theft/replay, user enumeration via auth endpoints, session fixation / stolen cookie, cross-site request abuse.

**Funding threats** — Spamming funding session mint endpoints, spamming funding refresh bridge, attempting to credit without real funds, attempting to exceed daily caps, WebView "focus refresh storms".

**Challenge threats** — Double-commit an event, replay roll/draw requests, bypass POWER gating, inflate streak without real saves.

**Push threats** — Push spam (looping reminders), deeplink injection.

---

## Controls Implemented

### 1) Authentication & Session Security

- Magic link tokens are single-use (`consumedAt`) and short TTL (15m).
- No user enumeration: `/auth/start` always returns `{ ok: true }`.
- Token & session storage is hashed: `sha256(raw + AUTH_PEPPER)`; raw never stored.
- **Session cookie:** httpOnly, sameSite=lax, secure in production, path=/
- **Sliding session renewal:** Renew if expiresAt within window. Single-flight lock per session id. `X-Session-Renewed: 1` debug header.

### 2) Authorization

- All `/users/:userId/*` routes: `requireAuth`, `requireUserIdMatch` (403 if mismatch).
- Challenge/event actions: resolve owning userId from DB, verify equals request.user.id.
- UI uses server-driven actions/limits, but backend remains source of truth.

### 3) Idempotency & Ledger Integrity

- Challenge commits are idempotent (`challenge_dep_<eventId>`).
- Scheduled events are deterministic (`sched_<ucId>_<YYYYMMDD>`).
- Funding refresh idempotency key includes both accounted & observed.
- Streak only updates on first completion today, guarded by "didSettle".
- Ledger integrity check endpoint exists: `/debug/health/ledger`.

### 4) Rate Limits & Abuse Controls

Layered, per endpoint:

- **Global** per-IP + per-user limits on action endpoints.
- **Auth** `/auth/start`: per-IP limit, per-email count, per-email cooldown (30s).
- **Funding:** `/funding/session`: per-user per-minute + per-day by minted FundingSession rows. `/funding/refresh`: per-user per-minute + per-day credits cap + per-call cap.
- **Withdraw wallet:** cooldown 30s, count/day, amount/day.

### 5) Challenge Due Windows (prevents "saving anytime" abuse)

- Daily challenges: UTC day window
- Weekly challenges: full week window anchored by schedule day
- Weather Wednesday: Wed-only window
- Envelopes: enforced draw frequency (daily/weekly), max draws per window

### 6) Onchain Safety

- Withdraw routing determined by metadata rail (BANK vs ONCHAIN).
- Watchdog fails stuck SUBMITTED actions: missing txHash → fail immediately; stale > 10m → recheck; hard fail > 30m if no receipt.
- Worker uses single-flight per job to prevent concurrent races.

### 7) Privacy & Tier Gating

- Normie-safe activity feed mapping: no crypto nouns, no txHash/chain unless showTxHistory.
- Server gating for: crypto labels, tx history visibility, vault shares, withdraw-to-wallet.
- POWER-only settings (dice sides, 2 dice, ×10; envelopes cadence/order/draws).

### 8) Push & Deeplink Safety

- Deeplinks are relative paths (`/` or `/challenges?...`) only.
- Service worker ignores cross-origin URLs.
- **Reminder dedupe:** ChallengeReminder(userChallengeId, dueWindowKey, channel).
- **Best target deeplink:** home if actionable Today card exists, else challenges focus route.

---

## Security TODOs (when you're ready)

- CSP headers for PWA
- CSRF token on state-changing endpoints (optional; sameSite lax cookie reduces risk, but not perfect)
- "Device list" session UI + revoke other sessions
- **Fraud heuristics:** suspicious funding session churn, repeated NO_CHANGE refresh spam, IP reputation checks
- Audit log table for sensitive actions (withdraw + wallet provision)
