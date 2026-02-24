# App Flow — StashJar

## Home boot (PWA)
1) `GET /auth/me`
- if 401 -> redirect to `/login?returnTo=…`
2) `GET /users/:id/home?context=pwa`
- populate: config/actions/limits, wallet, funding, stash, today, active challenges
3) Render:
- funding CTA (mode from server)
- streak chip
- Today banner + cards
- All done panel if complete

## Home boot (Miniapp shell)
1) `GET /auth/me` (cookie-based session)
2) `GET /users/:id/home?context=miniapp`
- funding.ui.mode = open_in_wallet
- deeplinkKind = env|generated|none
- optional waiting_for_funds banner
3) “Add money” opens deeplink
4) On return to foreground (focus/visibility):
- call funding refresh bridge
- if SETTLED -> refetch home

## Funding flow (PWA)
- Tap “Add money”
- call `POST /funding/session` (if enabled)
- open FundCard modal (session token)
- on close: `POST /users/:id/funding/refresh`, poll if NO_CHANGE
- update stash totals

## Challenge flow
- Today card shown only if actionable
- User completes:
  - input temp / weather
  - roll dice
  - draw envelope
- Server commits deposit + updates streak + activity
- Client refetches home snapshot

## Push flow
- Worker computes remindable challenges (due & incomplete)
- Sends push with deeplink to:
  - home focus if a Today card exists
  - otherwise `/challenges?focus=active&userChallengeId=...`
- Notification click focuses existing tab and navigates in-app
