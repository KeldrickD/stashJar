# Mini App Packaging

## Goal

Run one Next.js app in two shells:

- PWA mode (normal browser)
- Mini App mode (embedded webview / Frame runtime)

Server stays authoritative via:

- `GET /users/:id/home?context=pwa|miniapp` (query wins)
- fallback: `X-App-Context: miniapp|pwa`

## 1) Required env/config

### PWA (Next.js)

- `NEXT_PUBLIC_API_BASE` = your ledger-service origin
- `NEXT_PUBLIC_CDP_PROJECT_ID` = OnchainKit project id (needed for FundCard path)

### API (ledger-service)

- `APP_ORIGIN` = PWA origin (used for auth redirects)
- `API_ORIGIN` = API origin

Funding:

- `FUNDING_PROVIDER=coinbase`
- `CDP_PROJECT_ID`, `CDP_API_KEY`

Miniapp deeplink (optional):

- `MINIAPP_FUND_DEEPLINK` (if you want `env` deeplink)

Push:

- `PUSH_ENABLED=true`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`

## 2) Runtime context rules (source of truth)

### Request context precedence

1. `?context=miniapp|pwa` (query param)
2. `X-App-Context: miniapp|pwa` (header fallback)
3. default: `"pwa"`

### Expected server outputs

In `pwa` context:

- `home.funding.ui.mode = "fundcard"`
- `config.actions.preferredFundingRail = "FUND_CARD"` (if funding enabled)

In `miniapp` context:

- `home.funding.ui.mode = "open_in_wallet"`
- `config.actions.preferredFundingRail = "OPEN_IN_WALLET"` (if funding enabled)
- `home.funding.ui.deeplinkKind`:
  - `"env"` if `MINIAPP_FUND_DEEPLINK` set
  - `"generated"` if not set but wallet address exists
  - `"none"` if missing wallet address (or no deeplink possible)

## 3) Miniapp return bridge behavior (client)

### Trigger sources

- `window.focus`
- `document.visibilitychange` when `visibilityState === "visible"`

### Guardrails

- Only runs when `preferredFundingRail === "OPEN_IN_WALLET"`
- Debounced: min 8s between attempts
- Calls `funding/refresh` only
- Calls `refreshEverything()` only when refresh returns `SETTLED`

This keeps refresh traffic safely under limits.

## 4) Deep link + navigation rules

### Push deeplink strategy (best target)

- If today has a matching card: `/?focus=challenge&userChallengeId=<id>`
- Else: `/challenges?focus=active&userChallengeId=<id>`

### SW navigation

- If URL is absolute and same-origin: normalize to path and `router.replace(path)`
- If cross-origin: ignore (do not navigate outside app)

## 5) Miniapp-specific funding experience (expected UX)

### OPEN_IN_WALLET rail

- CTA: `Add money`
- If deeplink exists: open in wallet context
- Else: show helper text and fallback to manual refresh

### Banner

`waiting_for_funds` appears only when:

- miniapp context
- no higher-priority banner (`commit_pending`, `needs_input`)
- `lastRefreshAt` older than 3 minutes
- `observedBalance - accountedBalance >= $1`

## 6) Test matrix (4 cases)

Use a single test user with wallet provisioned.

### Case A — PWA + FundCard rail

Setup:

- Open in normal browser
- Call home with `?context=pwa` (or omit)

Expect:

- `funding.ui.mode === "fundcard"`
- CTA opens session modal path
- Closing modal triggers refresh + poll
- `waiting_for_funds` banner does not appear

### Case B — Miniapp + Open-in-wallet rail

Setup:

- Open embedded (or simulate with `?context=miniapp`)
- Ensure funding enabled and wallet ready

Expect:

- `funding.ui.mode === "open_in_wallet"`
- CTA opens deeplink
- On return (`focus`/`visible`), refresh runs
- Home refetch only on `SETTLED`
- `waiting_for_funds` appears only if `observed - accounted >= $1` and refresh is stale

### Case C — Miniapp but deeplink unavailable

Setup:

- Force `deeplinkKind="none"` (for example no wallet or disable deeplink generation)

Expect:

- CTA shows helper copy and falls back to manual refresh bridge
- No crashes, no cross-origin opens

### Case D — Push notification navigation

Setup:

- Keep app already open in a tab
- Click push notification deeplink

Expect:

- Existing tab focuses
- App navigates in-place (no new tab)
- Highlight/scroll lands on Today card or Active challenge target

## 7) Pass/fail sanity script (manual)

- Start daily Temperature challenge with `primeToday=true`
- Save temp; activity shows `Challenge saved $X`
- Trigger funding (add USDC); refresh bridge credits

Confirm:

- `GET /users/:id/home?context=pwa` shows fundcard rail
- `GET /users/:id/home?context=miniapp` shows open_in_wallet rail and deeplinkKind

## 8) CI recommendation

Add CI safety checks:

- `pnpm -C apps/pwa install`
- `pnpm -C apps/pwa lint`
- `pnpm -C apps/pwa build`

## 9) Next enhancement: MiniApp header adapter

To avoid relying on query params in production, add a small client adapter that sends `X-App-Context: miniapp` on API requests when embedded, while still allowing query override for debugging.

Recommended behavior:

- if query has `context`, use it as explicit override
- else if embedded runtime detected, send `X-App-Context: miniapp`
- else send `X-App-Context: pwa`

This keeps request context deterministic across hosts and easy to inspect.
