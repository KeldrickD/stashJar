# API Contract – StashJar

## Auth

**GET** `/auth/me`

Returns:

```json
{
  "userId",
  "wallet": { "ready", "type", "chain", "address" },
  "funding": { "enabled", "provider", "rail" }
}
```

---

## Home

**GET** `/users/:id/home?context=pwa|miniapp`

Returns:

```json
{
  "stash",
  "today",
  "activeChallenges",
  "funding",
  "config"
}
```

---

## Funding

**POST** `/funding/session`

Returns `sessionToken` (200)

- `429` daily_limit
- `503` disabled

**POST** `/users/:id/funding/refresh`

Returns:

```json
{
  "asOf",
  "observed",
  "result": "SETTLED" | "NO_CHANGE"
}
```

**POST** `/users/:id/withdraw/wallet`

- `429` daily_limit when exceeded.

---

## Challenges

**PATCH** `/users/:id/challenges/:ucId/settings`

Persists:

- dice settings
- envelopes settings
- autoCommit
- catchUp

---

## Cron

**POST** `/cron/weekly-recap`

Sends weekly recap to POWER/DEV users.
