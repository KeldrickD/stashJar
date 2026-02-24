# Backend Structure — ledger-service + onchain-service

## ledger-service responsibilities
- Identity + auth (magic link, sessions, renewal)
- User config computation (tier/flags/actions/limits)
- Challenge system:
  - templates, scheduling, due windows
  - event creation, commit, caps, commit-pending
  - today cards + banners + active challenges
- Funding:
  - funding session minting
  - refresh bridge + caps + audit (FundingSession)
- Push/email:
  - subscriptions + reminders driven by due windows
  - weekly recap

## onchain-service responsibilities
- Vault interactions
- Worker that continuously:
  - reconciles intents to onchain actions
  - marks-to-market
  - watchdogs stuck actions

## Data boundaries
- ledger-service is the “product ledger” (payment intents, challenge events, reminders).
- onchain-service is execution + reconciliation.

## Idempotency principles
- Challenge scheduled event ids are deterministic (sched_<ucId>_<YYYYMMDD>).
- Challenge commits are idempotent by key `challenge_dep_<eventId>`.
- Funding refresh is idempotent by `(accountedBefore, observedNow)` key.
- Reminder sends are de-duplicated per due window via `ChallengeReminder (userChallengeId, dueWindowKey, channel)`.

## Rate limiting
- IP limits for /auth/start
- Per-email count + cooldown for /auth/start
- Per-user rate limit for action endpoints (commit, set-temperature, roll, draw)
- Funding session and funding refresh limits
