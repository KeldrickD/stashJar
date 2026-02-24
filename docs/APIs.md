# APIs — StashJar (ledger-service)

Conventions:
- All authenticated calls use the session cookie `stash_session` (credentials included).
- Error bodies are JSON `{ error: "...", ... }`.
- Daily limits return `nextAllowedAt` (UTC midnight) and `retryAfterSeconds`.

## Auth

### POST /auth/start
Body:
```json
{ "email": "user@example.com", "returnTo": "/challenges" }
```
Response:
```json
{ "ok": true }
```

### GET /auth/callback?token=…
Sets session cookie, redirects to APP_ORIGIN/auth/success?returnTo=...

### POST /auth/logout
Response:
```json
{ "ok": true }
```

### GET /auth/me
Response:
```json
{
  "userId": "uuid",
  "email": "user@example.com",
  "config": { "tier": "NORMIE", "flags": {}, "actions": {}, "limits": {} },
  "wallet": { "ready": true, "provisioning": false, "type": "SMART", "chain": "base", "address": "0x..." },
  "funding": {
    "enabled": true,
    "provider": "coinbase",
    "rail": "USDC_BASE",
    "disabledReason": null,
    "limits": { "minDepositCents": 100, "maxDepositCents": 10000, "maxCreditPerCallCents": 10000, "maxCreditsPerDayCents": 25000 },
    "ui": { "mode": "fundcard", "title": "Add money", "asset": "USDC", "helperText": "..." }
  }
}
```

## Home Snapshot

### GET /users/:userId/home?context=pwa|miniapp
Returns single payload used by Home boot:
```json
{
  "userId": "uuid",
  "config": { "tier": "POWER", "flags": {}, "actions": { "preferredFundingRail": "FUND_CARD" }, "limits": { } },
  "wallet": { "ready": true, "provisioning": false, "type": "SMART", "chain": "base", "address": "0x..." },
  "funding": {
    "enabled": true,
    "provider": "coinbase",
    "rail": "USDC_BASE",
    "disabledReason": null,
    "lastRefreshAt": "2026-02-07T13:00:00.000Z",
    "lastObservedBalanceMicros": "123000000",
    "limits": { "minDepositCents": 100, "maxDepositCents": 50000, "maxCreditPerCallCents": 50000, "maxCreditsPerDayCents": 200000 },
    "ui": {
      "mode": "open_in_wallet",
      "title": "Add money",
      "asset": "USDC",
      "helperText": "Open your wallet app, send USDC on Base, then return here.",
      "deeplinkKind": "generated",
      "deeplink": "https://go.cb-w.com/wallet/send?address=0x...&asset=USDC&chainId=8453"
    }
  },
  "stash": {
    "stashBalanceCents": 20000,
    "vaultValueCents": 45000,
    "totalDisplayCents": 65000,
    "lastMarkedAt": "2026-02-03T01:28:44.184Z",
    "markAgeSeconds": 6,
    "isStale": false
  },
  "today": {
    "banner": { "type": "needs_input", "pendingCount": 1, "label": "...", "subLabel": "..." },
    "cards": [ ]
  },
  "activeChallenges": [
    { "userChallengeId": "uuid", "name": "100 Envelopes", "templateSlug": "100_envelopes", "progress": "52/100", "settings": {}, "bounds": {} }
  ]
}
```

## Funding

### POST /users/:userId/wallet/provision
Creates a wallet (dev deterministic provider or real provider in prod).
Response:
```json
{ "userId":"uuid", "address":"0x...", "providerRef":"...", "chain":"base", "walletType":"SMART" }
```

### POST /funding/session
Body:
```json
{ "returnTo": "/", "context": "pwa" }
```
200:
```json
{
  "provider": "coinbase",
  "enabled": true,
  "sessionToken": "…",
  "expiresAt": "2026-02-07T13:10:00.000Z",
  "wallet": { "chain": "base", "address": "0x..." },
  "ui": { "mode": "fundcard", "title": "Add money", "asset": "USDC" }
}
```
429 daily_limit:
```json
{
  "error": "daily_limit",
  "retryAfterSeconds": 12345,
  "nextAllowedAt": "2026-02-08T00:00:00.000Z",
  "limitPerDay": 50,
  "usedToday": 50
}
```
429 rate_limit:
```json
{ "error":"rate_limit", "retryAfterSeconds": 60 }
```

### POST /users/:userId/funding/refresh
Reads onchain USDC and credits stash if delta >= $1.
200:
```json
{
  "userId": "uuid",
  "asOf": "2026-02-07T13:00:01.000Z",
  "wallet": { "address": "0x...", "chain": "base" },
  "observed": { "walletAddress": "0x...", "walletUsdcBalanceMicros": "123000000" },
  "accounting": {
    "accountedPrincipalUsdcMicrosBefore": "100000000",
    "accountedPrincipalUsdcMicrosAfter": "123000000",
    "deltaMicros": "23000000",
    "deltaCents": 2300
  },
  "result": { "status": "SETTLED", "createdPaymentIntents": 1, "paymentIntentIds": ["uuid"] }
}
```
200 NO_CHANGE:
```json
{
  "userId": "uuid",
  "asOf": "2026-02-07T13:00:01.000Z",
  "wallet": { "address": "0x...", "chain": "base" },
  "observed": { "walletAddress": "0x...", "walletUsdcBalanceMicros": "100000000" },
  "accounting": { "accountedPrincipalUsdcMicrosBefore": "100000000", "accountedPrincipalUsdcMicrosAfter": "100000000", "deltaMicros": "0", "deltaCents": 0 },
  "result": { "status": "NO_CHANGE" }
}
```
429 daily_limit:
```json
{
  "error": "daily_limit",
  "retryAfterSeconds": 12345,
  "nextAllowedAt": "2026-02-08T00:00:00.000Z",
  "usedCents": 25000,
  "maxCreditsPerDayCents": 25000
}
```

## Challenges

### POST /challenges/start?primeToday=true
Body:
```json
{ "userId":"uuid", "templateSlug":"temperature_daily", "settings": { "autoCommit": false } }
```
Response:
```json
{ "userChallengeId":"uuid", "primedEventId":"uuid" }
```

### GET /users/:userId/challenges/today
Returns cards[] + banner? (server computes actionable only).

### PATCH /users/:userId/challenges/:userChallengeId/settings
Body (subset):
```json
{
  "dice": { "sides": 12, "multiDice": 2 },
  "envelopes": { "maxDrawsPerDay": 2, "cadence": "daily", "order": "reverse" },
  "scaleOverride": 10
}
```

### POST /challenges/:challengeId/events/:eventId/set-temperature
Body examples:
```json
{ "mode":"manual", "temp":72, "unit":"F" }
{ "mode":"gps", "lat":33.75, "lon":-84.39, "unit":"F" }
{ "mode":"place", "zip":"30303", "unit":"F" }
```

### POST /challenges/:challengeId/events/:eventId/roll
Body (optional overrides, server-gated):
```json
{ "sides": 12, "multiDice": 2 }
```

### POST /challenges/:id/draw
Enforces one-draw-per-day (or maxDrawsPerDay) by UTC day.

## Push

### POST /push/subscribe
Body:
```json
{ "endpoint":"...", "keys": { "p256dh":"...", "auth":"..." } }
```

### GET /push/vapid-public
Response:
```json
{ "vapidPublicKey":"..." }
```

## Health/Debug
- `GET /health`
- `GET /debug/health/ledger`
