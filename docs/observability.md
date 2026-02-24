# Observability — StashJar

## Logging
- Request timing logs emitted on every response:
  - route, method, userId (if present), durationMs, statusCode
- Avoid PII in logs:
  - emailDomain only
  - ipHash for funding session auditing

## Error taxonomy (server)
Primary `error` codes used in JSON bodies:
- `unauthorized`
- `forbidden`
- `invalid_settings`
- `rate_limit` (Retry-After, retryAfterSeconds)
- `daily_limit` (nextAllowedAt, retryAfterSeconds)
- `wallet_not_ready`
- `funding_disabled`
- `funding_session_not_configured`
- `chain_unavailable` / `chain_error`
- `session_token_failed`

## Client handling principles
- Any `daily_limit` shows a unified countdown component driven by `nextAllowedAt`.
- `NO_CHANGE` is not treated as an error; it triggers bounded polling.

## Dashboards (suggested)
### API health
- req count by route/method/status
- p95 latency by route
- error rate by error code

### Auth
- /auth/start counts
- cooldown hits
- token send failures by emailDomain

### Funding
- /funding/session minted per day
- session daily_limit hits
- /funding/refresh SETTLED vs NO_CHANGE
- credited cents/day by tier
- chain read failures (RPC)

### Challenges
- commits/day
- streak distribution
- commit_pending usage rate
- cap skip counts

### Push/email
- push sends, delivery failures (410/404 revokes)
- reminder conversions (push click -> completion)
- weekly recap send success/failure

## Alerts (suggested)
- Funding refresh chain error spike
- Auth send failures spike
- Push failures spike
- Database latency spike
- Mark job staleness > threshold
