# Security Model — StashJar

## Assets
- User identity/session (stash_session cookie)
- Savings ledger correctness (PaymentIntents, LedgerEntries)
- Challenge integrity (events, due windows, caps)
- Funding credit correctness (refresh bridge)
- Push/email channels (abuse prevention)
- PII (email addresses, IP, user agent)

## Trust boundaries
- Browser/PWA (untrusted)
- Miniapp webview (untrusted, may have limited APIs)
- ledger-service (trusted application boundary)
- Postgres (trusted persistence)
- Chain RPC (partially trusted external)
- Email provider (Resend) + Push provider

## Authentication
- Magic link auth tokens:
  - raw token: base64url(randomBytes(32))
  - stored hash: sha256(raw + AUTH_PEPPER)
  - single use + TTL
- Session cookie:
  - `stash_session` httpOnly, sameSite=lax, secure in production
  - stored sessionHash (sha256(raw + pepper))
  - sessions can be revoked
  - sliding renewal when close to expiry (single-flight)

## Authorization
- All `/users/:userId/*` routes require:
  - authenticated session
  - userId path match against session userId
- Challenge actions ensure resolved userId matches session user.

## Rate limiting & anti-abuse
Layered auth start:
- per-IP rate limit
- per-email count limit
- per-email cooldown (30s)
- constant `{ ok: true }` response to avoid enumeration

Action endpoints:
- per-user action rate limiting (commit, set-temp, roll, etc.)
- funding session mint rate limiting:
  - per minute + sessions per day (enforced by FundingSession table)
- funding refresh:
  - per minute + daily credit limit

## Data minimization
- Logs: store only email domain (not full email) in failure/cooldown logs
- FundingSession: store `ipHash` (sha256 truncated), not raw IP
- PushSubscription: store endpoint and keys, allow revocation

## Ledger integrity
- Idempotent keys for commits and refresh
- Health endpoint for ledger invariants
- Watchdog for stuck onchain actions

## Threat model (high level)
- Token reuse/replay: prevented via `consumedAt` + hashing.
- Session theft: mitigated via httpOnly cookie + short renewal window + revocation.
- Abuse/spam: rate limits, cooldowns, no enumeration.
- Funding credit fraud: chain read delta + accounted principal; caps per call/day; idempotency.
- Reminder spam: ChallengeReminder uniqueness per window/channel.

## Recommended production hardening
- Strict CSP + secure headers on PWA
- Database-level monitoring for slow queries (AuthToken lookup, FundingSession counts)
- Background jobs isolated with cron secret
- Webhook validation if adding provider callbacks later
