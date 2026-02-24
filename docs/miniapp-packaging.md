# Miniapp Packaging — Frames / MiniKit Checklist

This doc describes how to package StashJar as an embedded miniapp shell **without changing the product contract**: the server remains authoritative via `home?context=miniapp` and `config.actions.preferredFundingRail`.

## What “miniapp mode” means in StashJar
- Client loads home snapshot with `context=miniapp` (query wins; header fallback supported).
- Server responds with:
  - `funding.ui.mode = "open_in_wallet"`
  - `funding.ui.deeplinkKind = "env" | "generated" | "none"`
  - `config.actions.preferredFundingRail = "OPEN_IN_WALLET"` (when enabled)
- Client behavior:
  - Add money opens deeplink if present
  - On return to foreground, call refresh bridge (debounced; refetch home only on SETTLED)

## Host integration inputs StashJar expects
- A way to open external deeplinks (wallet app)
- A reliable “returned to foreground” signal (focus/visibilitychange) — already implemented
- A way to pass app context:
  - Preferred: `?context=miniapp` on initial URL
  - Fallback: request header `X-App-Context: miniapp` from host proxy (if applicable)

## Deeplink contract
- If `MINIAPP_FUND_DEEPLINK` is set on server -> `deeplinkKind="env"` and use it verbatim.
- Else server generates:
  - `https://go.cb-w.com/wallet/send?address=<ADDR>&asset=USDC&chainId=8453`
  - where `<ADDR>` is the user smart wallet address (URL-encoded)
- Else `deeplinkKind="none"` and UI falls back to manual refresh instructions.

## Frames/MiniKit checklist (host-agnostic)
Because exact fields differ by platform/version, treat this as a checklist:
- [ ] Miniapp entry URL supports adding `?context=miniapp`
- [ ] Ensure cookies are preserved (session cookie auth)
- [ ] Ensure HTTPS (required for service worker/push in real deployments)
- [ ] Allow external navigation to `https://go.cb-w.com/...` (or your env override deeplink)
- [ ] Verify foreground return triggers focus/visibilitychange
- [ ] Confirm same-origin routing works for deeplinks:
  - `/?focus=challenge&userChallengeId=...`
  - `/challenges?focus=active&userChallengeId=...`

## Test matrix (must-pass)
Run these 4 cases on the real host and in a normal browser:

### Case 1 — PWA funding via FundCard
- context: `pwa`
- Expected:
  - `funding.ui.mode=fundcard`
  - tapping Add money opens FundCard
  - refresh bridge credits stash

### Case 2 — Miniapp open-in-wallet + return bridge
- open `/ ?context=miniapp`
- Expected:
  - `funding.ui.mode=open_in_wallet`
  - deeplinkKind is env or generated
  - open wallet, send USDC, return
  - refresh runs on focus/visible, credits stash, clears waiting banner

### Case 3 — Push deeplink navigation to existing tab
- app already open
- click push notification
- Expected:
  - focuses existing tab
  - in-app route changes to deeplink
  - scroll/highlight works

### Case 4 — No wallet / wallet not ready
- new user, no wallet provisioned
- Expected:
  - funding disabled or wallet_not_ready
  - UI offers “Set up wallet”
  - after provision -> refresh bridge works

## Known caveats
- Embedded webviews sometimes throttle focus events -> visibilitychange handler is required (already added).
- Some hosts block external deeplinks -> use env override deeplink compatible with that host.
