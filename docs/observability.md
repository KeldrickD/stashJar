# Observability – StashJar

## Goal

Make the system debuggable in production:

- Know *what* happened (funding/session/refresh/challenge commits)
- Know *why* (rate limits, caps, chain reads)
- Know *where* it's slow (endpoint latency + DB hotspots)
- Know if it's breaking (health checks + error taxonomy)

---

## 1) Logging standard

### Required fields (every request log)

Already implemented: request timing logs on response. Add/keep these keys consistently:

- `requestId` (Fastify request id)
- `route`, `method`
- `statusCode`
- `durationMs`
- `userId` (if known)
- `context` (pwa|miniapp when available)
- `build` (from X-Build timestamp)

### Funding-specific logs (recommended)

**When session token minted:**

- `event="funding_session_minted"`
- userId, context, provider="coinbase", expiresAt, walletAddress (ok), ipHash (not raw IP), limitsSnapshot

**When refresh runs:**

- `event="funding_refresh"`
- userId, walletAddress, observedMicros, accountedMicros, deltaCents
- result="SETTLED|NO_CHANGE", capped="per_call|daily|none"

### Challenge action logs (recommended)

- `event="challenge_commit"` with userChallengeId, eventId, amountCents, status
- `event="challenge_roll"` / challenge_draw / set_temperature

### Push worker logs

- `event="push_reminder_send"`
- userId, subscriptionId, channel="PUSH", dueWindowKey, templateSlug, expectedAction
- ok=true/false, statusCode for failures

---

## 2) Error taxonomy (UI + logs)

Use stable error codes in JSON bodies. Keep them canonical.

**Auth:** unauthorized (401), forbidden (403), cooldown (200 OK but log reason, for /auth/start).

**Funding session:** rate_limit (429), daily_limit (429) with nextAllowedAt, wallet_not_ready (409), funding_session_not_configured (501), funding_disabled (503), session_token_failed (503).

**Funding refresh:** rate_limit (429), daily_limit (429) with nextAllowedAt, wallet_not_ready (409), funding_disabled (503), chain_unavailable (503), chain_error (503).

**Challenges:** invalid_settings (400), forbidden (403), daily_limit (429) for envelopes draw ritual, rate_limit (429) for actions.

**Withdraw:** cooldown (429, retryAfterSeconds), daily_limit (429, nextAllowedAt, usedCents, limitCents), rate_limit (429).

**Rule:** never return raw stack traces to clients.

---

## 3) Health checks

**Existing:** GET `/health` (basic liveness), GET `/debug/health/ledger` (ledger integrity).

**Recommended additions:**

- **GET /debug/health/chain** — checks RPC reachability + USDC contract read. Returns ok, chainId, blockNumber, latencyMs.
- **GET /debug/health/push** — checks push enabled + VAPID present. Optionally sends a dry-run to a test endpoint (disabled by default).
- **GET /debug/health/email** — checks provider config (resend keys/from). Does not send.

---

## 4) Metrics (what to chart)

Even if you don't deploy Prometheus immediately, these are the KPIs to track.

**Core product:** DAU / WAU (based on /home calls or completed challenge deposits), Streak distribution (0, 1–3, 4–7, 8–30, 30+), Challenge completion counts by template, "All done" rate (users who finish daily action).

**Funding:** Funding session mints/day, Funding refresh calls/day and SETTLED ratio, Average time from session minted → first SETTLED refresh, Daily-limit hits (session + refresh), Average credited amount per day by tier.

**Push:** Reminders sent/day, CTR proxy (notificationclick events are hard, so approximate by /home?focus=challenge... loads within X minutes of send), Subscription count by tier, Push errors: 404/410 (stale subscriptions).

**Performance:** p50/p95/p99 latency for /users/:id/home, /funding/session, /users/:id/funding/refresh, challenge action endpoints; DB query time (if you add Prisma logging); Worker job durations (allocate/reconcile/redeem/watchdog).

---

## 5) Dashboards (starter set)

**Dashboard A — Product health:** "Challenge deposits settled today", "Streak todayCompleted rate", "All done panel shown count", "Active challenges per user".

**Dashboard B — Funding health:** "Session mints", "Refresh SETTLED vs NO_CHANGE", "Daily-limit hits", "Median time to credit after funding".

**Dashboard C — Infra:** Endpoint latency (p95) for /home, /refresh; Error rate by endpoint and error code; Chain read failures (chain_unavailable, chain_error); Worker job durations + error counts.

**Dashboard D — Push:** Reminders sent; Success vs revoked subs; Remindables count vs actually sent.

---

## 6) Tracing (optional but powerful)

If you add OpenTelemetry later:

- Trace root spans per request
- Child spans: prisma.query, chain.read.balance, cdp.session_token.create, push.send
- Correlate with requestId.

---

## 7) Operational runbooks (minimum)

**Funding not crediting:** Check /debug/health/chain; Check last refresh logs for observedMicros, accountedMicros; Confirm banner conditions (observed-accounted >= $1); Ensure refresh caps not blocking (daily/per-call); Confirm wallet address matches FundCard destination.

**Push not delivering:** Check /push/status; Confirm VAPID configured and PUSH_ENABLED; Look for 410/404 revocations; Verify SW registered and permissions granted; Confirm deeplink is relative and same-origin.

**Auth issues:** Confirm cookie present (httpOnly); Check session expiry + renewal window; Confirm CORS credentials: true and allowed origin.
