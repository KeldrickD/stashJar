# PRD — StashJar

## One-liner
StashJar is a “habit-first” savings app that turns saving into daily and weekly rituals (temperature, dice, envelopes, weekly increment), with a normie-safe UI and optional onchain rails (Base) behind the scenes.

## Goals
- Make saving **easy, repeatable, and fun**.
- Keep the product **normie-friendly**: no crypto nouns unless explicitly enabled via flags.
- Support both:
  - **PWA** (web onboarding, embedded/smart wallet + FundCard)
  - **Base miniapp shell** (open wallet -> fund -> return -> refresh bridge)
- A single source of truth: **ledger-service** computes “what to do now,” limits, actions, and UI contracts.

## Non-goals (for MVP)
- Full KYC, banking rails, fiat custody, or regulated money transmission.
- Cross-chain, multi-asset vault strategies beyond USDC on Base.
- Complex multi-user/family features.

## Personas
### NORMIE
- Wants a simple savings ritual.
- Doesn’t care about chain, tx hashes, vault shares.
- Needs clear guidance: “Tap once -> saved.”

### POWER
- Wants advanced challenge variants (dice sides, 2 dice, ×10 mode; envelopes cadence/limits).
- Can withdraw-to-wallet.
- May want recovery mechanics (make-up saves, streak shield).

### DEV
- Like POWER, but with higher limits for testing and internal operation.

## Core loops
1) **Daily ritual loop**
- Open app -> see Today cards -> complete 1 action -> see “All done ✅”
- Streak updates on first successful challenge save of the UTC day.

2) **Funding loop**
- Fund USDC to the user’s wallet using FundCard (PWA) or open wallet deeplink (miniapp).
- User returns -> StashJar runs **funding refresh bridge**:
  - Observe USDC balance on-chain
  - Credit stash if delta >= $1 and within limits
  - Show “Waiting for funds?” banner only when a real delta is visible

3) **Retention**
- Push reminders based on challenge due windows.
- Weekly recap email with totals + streak.

## Challenges (MVP)
- **Temperature Daily** (input-first): save temperature amount (scale=1 default; optional scale=10).
- **Weather Wednesday** (input-first): save Wednesday high temp; manual fallback.
- **Dice Daily** (input-first): deterministic roll -> save.
- **100 Envelopes** (draw): one draw per day (server-enforced; hide card when already drew today).
- **52-Week / Weekly increment** (scheduled): week window anchored on schedule day; catch-up bounded; caps apply.

## Key product requirements
### Today surface (server-driven)
- `/users/:id/home` returns:
  - today.cards (actionable only)
  - today.banner (commit_pending, needs_input, waiting_for_funds)
  - activeChallenges strip (progress even when today is empty)

### Normie-safe activity feed
- Challenge saves show as “Challenge saved $X” with a subtitle like:
  - “Temperature Daily - 72°F”
  - “Weather Wednesday - WED - 71°F”
  - “Dice Daily - Rolled 4”
  - “100 Envelopes - Envelope 48”
  - “52-Week Challenge - Week 10”
- Crypto/chain metadata is gated by flags/actions.

### Funding
- Wallet readiness surfaced in `/auth/me` and `/users/:id/home`.
- UI mode comes from server:
  - PWA: `funding.ui.mode = "fundcard"`
  - Miniapp: `funding.ui.mode = "open_in_wallet"` + `deeplinkKind`
- Bridge endpoint: `POST /users/:id/funding/refresh`

### Limits and actions
- Server computes `config.actions` and `config.limits` so UI never guesses based on tier names.

## Success metrics (MVP)
- Day-1 activation: % users who complete at least one challenge save.
- 7-day retention.
- Average saves/week and streak distribution.
- Funding conversion: users who successfully credit stash after starting funding.
- Push open rate and completion rate after reminder.

## Open questions
- Final Miniapp host + deeplink formats (generated vs env override).
- Exact “streak recovery” UX (double-save vs shield).
- Whether weekly recap is weekly-only or also monthly.
