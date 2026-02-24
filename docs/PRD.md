# Product Requirements Document – StashJar

## Problem

- People struggle to save consistently.
- Web2 users find crypto intimidating.
- Web3 users lack habit-driven financial tools.

## Core Product

StashJar allows users to:

- Start structured savings challenges
- Fund via debit/bank (PWA) or USDC on Base (Mini App)
- Build streaks
- Receive reminders
- Withdraw to wallet (POWER tier)

---

## User Types

**Normie** — Email login. Debit/bank funding. $100 max deposit. No onchain withdraw.

**Curious** — Same as Normie. Slightly higher caps.

**POWER** — Advanced dice/envelope rules. Onchain withdraw. $500+ limits. Weekly recap emails.

**DEV** — Highest limits. All features unlocked.

---

## Core Features

### 1. Challenge Engine

- **Temperature** (daily)
- **Dice** (daily/weekly)
- **100 Envelopes**
- **Weekly 52**

### 2. Funding Rails

Server decides:

- `FUND_CARD`
- `OPEN_IN_WALLET`
- `MANUAL_REFRESH_ONLY`

### 3. Reminder Engine

- Push
- Weekly recap email
- Deep link targeting

### 4. Limits & Risk Controls

- Sessions/day
- Credits/day
- Withdraw/day
- Per-call caps

---

## Success Metrics

- Daily saves per user
- Funding → refresh conversion rate
- Streak retention
- 7-day retention
- 30-day retention
- POWER tier upgrade %
