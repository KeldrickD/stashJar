# Frontend Guidelines — PWA + Miniapp Shell

## Core rules
1) **Never infer tier by string**. Use `home.config.actions` and `home.config.limits`.
2) **Server is source of truth** for:
   - funding UI mode (fundcard vs open_in_wallet)
   - deeplinkKind and deeplink
   - daily limits and nextAllowedAt
   - today cards/banners and “actionable only”
3) **Use home snapshot** as primary boot/refresh call.

## Error handling
- Treat 429 bodies as typed objects:
  - `rate_limit` -> show retry countdown or gentle message
  - `daily_limit` -> always show `DailyLimitCountdown(nextAllowedAt)`
- For funding refresh NO_CHANGE: show “Nothing new yet” and poll briefly (max 60s).

## Miniapp behaviors
- When `actions.preferredFundingRail === "OPEN_IN_WALLET"`:
  - open deeplink (if present)
  - on focus/visibility -> call refresh bridge
  - refetch home only if refresh returns SETTLED

## Rendering patterns
- Today cards rendered via `TodayCardRenderer` with deterministic ordering.
- Use `focus=challenge&userChallengeId=...` routing for push deeplinks:
  - scroll & highlight target card if present
  - fallback to active challenges strip if not

## Service worker
- On notification click:
  - focus existing tab
  - postMessage NAVIGATE
- App listens and router-replaces in the existing tab.

## Copy tone
- Normie-safe, no crypto terms unless user explicitly enabled crypto labels.
