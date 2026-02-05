Product Requirements Document (PRD)
My Stash Jar
Version

v1.0 (MVP → Public Beta)

Owner

Product / Architecture: You
Execution: AI Coding Agent / Engineering Team

1. Product Vision

My Stash Jar is a consumer savings app that feels like a game, not finance.

Users save money through fun, viral challenges (envelopes, dice, weekly, weather) while funds quietly earn yield via decentralized infrastructure. Crypto is invisible by default. Users feel progress, not complexity.

“The best technology is invisible.”

2. Core Principles

No crypto jargon for normies

Double-entry accounting everywhere

Idempotent everything

Auto-savings must be safe

Power users can go deeper — but never required

3. User Tiers
3.1 NORMIE (Default)

No crypto labels

No chain names

No wallet withdrawals

Sees totals only

Can use challenges + auto-save

3.2 CURIOUS

Same as NORMIE (future expandability)

3.3 POWER

Sees tx hash + chain

Can withdraw to wallet

Can stake multiple assets

Advanced analytics

3.4 DEV

Everything unlocked

Tier gates behavior via resolved feature flags.

4. System Architecture (High Level)
[PWA / Base Mini App]
        ↓
[Ledger Service] — authoritative money state
        ↓
[Onchain Service] — vault interaction + workers
        ↓
[Base / Hardhat / Sepolia]

5. Services Overview
5.1 Ledger Service (Source of Truth)

Responsibilities

Users

Challenges

Ledger (double-entry)

PaymentIntents

Activity Feed

Tier/Flag resolution

Challenge scheduling + auto-commit

Database

PostgreSQL

Prisma ORM

5.2 Onchain Service

Responsibilities

Allocate deposits to vault

Withdraw & redeem

Mark-to-market

Worker loops

Watchdog (stuck txs)

Chain abstraction (Hardhat → Base)

Uses viem.

5.3 Smart Contracts

Contracts

MockUSDC.sol (test)

StashVault.sol

Vault Behavior

ERC4626-style shares

previewDeposit / previewRedeem

Donation-safe share pricing

Withdraw request → redeem flow

6. Core Data Models (Simplified)
6.1 User
User {
  id
  tier: NORMIE | CURIOUS | POWER | DEV
  flags: Json
}

6.2 UserChallenge
UserChallenge {
  id
  userId
  templateId
  status: ACTIVE | COMPLETED
  startedAt
  settings: {
    autoCommit: boolean
    catchUp: boolean
    maxCatchUpEvents: number
  }
}

6.3 ChallengeEvent
ChallengeEvent {
  id
  userId
  userChallengeId
  scheduledFor
  occurredAt
  amountCents
  paymentIntentId?
  metadata
}

6.4 PaymentIntent
PaymentIntent {
  id
  userId
  type: DEPOSIT | WITHDRAW
  status: CREATED | PROCESSING | SETTLED | PAID
  amountCents
  metadata
}

6.5 LedgerEntry

(Double-entry, immutable)

7. Challenges System
Supported Types (v1)

100 Envelopes

Dice Roll

52-Week Increment

Weather Wednesday (weekday)

Temperature (daily, upcoming)

7.1 Scheduling Engine

Schedule Types

weekly

weekday

daily (next)

custom (future)

Idempotency

sched_<userChallengeId>_<YYYYMMDD>

7.2 Auto-Commit Rules

Events are always created

Auto-commit happens only if:

settings.autoCommit === true

Caps allow it

8. Safety Rails (Critical)
8.1 Caps
Cap Type	NORMIE	POWER
Daily Auto-Save	$50	$200
Per-Run	$200	$200

Overrides allowed via user flags.

8.2 Skipped Commits

When caps are exceeded:

Event remains uncommitted

Returned in skippedCap[]

Visible to UI

9. Challenge Autopilot APIs
9.1 Run Due Events
POST /users/:id/challenges/run-due


Creates scheduled events + auto-commits within caps.

9.2 Commit Pending (Apply Missed Saves)
POST /users/:id/challenges/commit-pending


Commits oldest uncommitted events until caps allow.

10. Ledger + Onchain Lifecycle
Deposit
ChallengeEvent → PaymentIntent (SETTLED)
→ Ledger Entries
→ OnchainAction (VAULT_DEPOSIT)
→ Vault shares minted

Withdraw (Bank or Wallet)
Withdraw Request
→ Share math via preview
→ Redeem
→ Funds paid

11. Workers (Onchain Service)
Job	Interval
allocate	10s
reconcile	3s
withdrawRequest	10s
redeem	10s
markToMarket	60s
watchdog	30s

Single-flight enforced.

12. Activity Feed (Normie-Safe)
Challenge Deposit
Title: “Challenge saved $48”
Subtitle: “100 Envelopes • Envelope 48”

Withdraw
Withdrawal requested
Withdrawal completed

Vault

“Stash is earning”

Crypto internals gated by flags

13. Stash Value API
GET /users/:id/stash/value


Returns:

stashBalanceCents

vaultValueCents

totalDisplayCents

freshness metadata

gated crypto fields

14. Feature Flags (Resolved)

Examples:

{
  showCryptoLabels: false,
  showTxHistory: true,
  enableOnchainWithdrawToWallet: true,
  enableMultiAssetStaking: true,
  dailyAutoSaveCapCents?: number
}

15. Frontend Requirements (PWA / Base Mini App)
Required Screens

Stash Home (jar UI)

Activity Feed

Challenges

Apply Missed Saves

Withdraw

Settings (tier-aware)

UX Rules

Never show “USDC”, “Base”, or “ERC-20” to normies

Always show progress + streaks

One-tap saves

16. Non-Goals (v1)

No fiat on-ramp UI

No public token

No NFT mechanics

No external weather API (yet)

17. Launch Readiness Checklist

 Ledger correctness

 Vault share safety

 Idempotency everywhere

 Caps enforced

 Worker stability

 Weather Wednesday

 PWA polish

 Base Mini App wrapper

18. Success Metrics

% users with ≥1 active challenge

Avg saves per week

% auto-committed vs manual

Retention at Day 7 / Day 30

Challenge completion rate

19. Hand-Off Instructions for AI Coding Agent

Implement exactly as specified.
Do not refactor accounting, idempotency, or safety rails.
All monetary actions must go through:

PaymentIntent

Ledger

OnchainAction