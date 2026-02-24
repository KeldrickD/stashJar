# StashJar – Project Plan

## Vision

StashJar is a habit-driven savings platform built for both Web2 users and Web3-native users.

It operates as:

- **A Progressive Web App (PWA)**
- **A Base Mini App (Frames / MiniKit style)**

The backend is the single source of truth for:

- Funding rails
- Tier permissions
- Daily limits
- Challenge rules
- Reminder targeting

---

## Phases

### Phase 1 — Core Saving Engine (Complete)

- Challenge system (temperature, dice, envelopes, weekly)
- Due window engine
- Persistent per-challenge settings
- Make-up saves (POWER)
- Streak tracking
- Server-driven limits
- Push reminders
- Magic-link auth
- Deposit & refresh bridge
- Funding rails (FundCard + Open-in-wallet)
- FundingSession logging

### Phase 2 — Production Hardening

- MiniApp packaging & runtime polish
- Funding abuse detection
- Analytics dashboard
- Fraud heuristics
- Withdraw-to-wallet UX polish
- Funding conversion tracking

### Phase 3 — Growth & Monetization

- Tier upgrades
- Streak shield monetization
- Referral program
- Sponsored challenges
- Social savings challenges

### Phase 4 — Scale

- Background jobs (queue instead of intervals)
- Rate-limit infra upgrade
- Caching layer
- Read replica
- Metrics & observability
