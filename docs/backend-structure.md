# Backend Architecture – Ledger Service

## Tech

- Node.js + TypeScript
- Express
- Prisma
- PostgreSQL
- viem (onchain read)
- web-push
- Resend (email)

---

## Core Domains

### 1. Auth

- Magic link
- Cooldown per email
- IP throttle
- No enumeration

### 2. Funding

- Session minting
- Refresh bridge
- FundingSession logging
- Daily limits
- Withdraw enforcement

### 3. Challenges

- Due window engine
- Persistent per-challenge settings
- Effective settings resolver
- Tier-based bounds
- Make-up saves
- Streak logic

### 4. Reminders

- Push worker
- Weekly recap cron
- Deep link targeting

---

## Important Models

| Model | Key Fields |
|-------|------------|
| **User** | tier, flags, email |
| **UserWallet** | walletType, address, accountedPrincipalUsdcMicros, lastObservedBalanceMicros, lastFundingRefreshAt |
| **FundingSession** | provider, context, walletAddress, chainId, expiresAt, ipHash, limitsSnapshot |
| **UserChallenge** | settings (JSON), templateSlug |
| **PaymentIntent** | type: DEPOSIT \| WITHDRAW, status, metadata.source |
