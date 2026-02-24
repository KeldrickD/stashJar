# MiniApp Packaging – StashJar

## Goal

Run the same product as:

- **PWA** (normal browser install / mobile Safari/Chrome)
- **Base MiniApp** (Frames/MiniKit embedded shell)

Server stays authoritative and returns context-aware funding + UX contracts.

---

## 1) Context contract (source of truth)

**Client → API**

Prefer query param; header is fallback.

- **Query:** `GET /users/:id/home?context=miniapp|pwa`
- **Header fallback:** `X-App-Context: miniapp|pwa`
- **Precedence:** `?context=` (wins) → `X-App-Context` → default `"pwa"`

**API → Client**

Home includes:

- `config.actions.preferredFundingRail`: `"FUND_CARD"` | `"OPEN_IN_WALLET"` | `"MANUAL_REFRESH_ONLY"`
- `funding.ui.mode`: `"fundcard"` | `"open_in_wallet"`
- `funding.ui.deeplinkKind`: `"env"` | `"generated"` | `"none"`
- optional `funding.ui.deeplink`
- `today.banner` may include `waiting_for_funds` (only when no higher-priority banner)

**Client must not infer rail/mode from tier strings.**

---

## 2) MiniKit / Frames checklist (exact integration points)

### A) Hosting + origin requirements

- PWA must be served over HTTPS in production (service worker + web push + wallet deep links).
- Ensure one stable origin (no random preview URLs) for: cookie session (`stash_session`), service worker scope (`/sw.js`), push subscription endpoints.

### B) App entry URL (MiniApp)

**Recommended:**

- Home: `https://<your-pwa-domain>/?context=miniapp`
- Challenges: `https://<your-pwa-domain>/challenges?context=miniapp`
- History: `https://<your-pwa-domain>/history?context=miniapp`

If the host app cannot append query params reliably, use the header fallback: `X-App-Context: miniapp`.

### C) Deeplink behavior (funding rail)

**Miniapp funding rail from server:**

- `preferredFundingRail === "OPEN_IN_WALLET"`
- `funding.ui.mode === "open_in_wallet"`

**Deeplink generation (server):**

- `MINIAPP_FUND_DEEPLINK` → deeplinkKind="env"
- else generate → deeplinkKind="generated"
- else none

**Client behavior:**

- If OPEN_IN_WALLET and deeplink exists → open it
- On return (focus / visibilitychange) → call funding/refresh debounced
- Only refetch /home after refresh returns SETTLED

### D) Push reminders (MiniApp note)

Web push typically works in a browser PWA context. If the MiniApp host environment blocks SW/push:

- Keep push toggle hidden using `config.actions.canPushReminders`
- Reminders fallback: weekly recap email (POWER+) or in-app banners.

---

## 3) Exact params your MiniApp wrapper should pass

**Required:** `context=miniapp`

**Optional (deeplink focus):** These are already supported:

- `/?focus=challenge&userChallengeId=<uuid>`
- `/challenges?focus=active&userChallengeId=<uuid>`

Used by push reminders and any external routing.

---

## 4) Test matrix (pass/fail)

**Setup:** API running with auth, funding optional. PWA running on HTTPS (or localhost for dev). One test user with: a wallet provisioned, at least one active challenge (dice/temp/weather/envelopes).

### Matrix

**1) Miniapp funding rail (OPEN_IN_WALLET)**

- **Given:** GET /users/:id/home?context=miniapp
- **Expect:** funding.ui.mode === "open_in_wallet", config.actions.preferredFundingRail === "OPEN_IN_WALLET", funding.ui.deeplinkKind in {"env","generated","none"}
- **CTA behavior:** If deeplinkKind !== "none" → tapping Add money opens wallet. On return to webview: focus/visibility triggers POST /users/:id/funding/refresh (debounced 8s). If SETTLED, then GET /users/:id/home?context=miniapp runs.
- **Pass criteria:** No more than ~1 refresh per return (debounce works). Home refetch happens only on SETTLED.

**2) PWA funding rail (FUND_CARD)**

- **Given:** GET /users/:id/home?context=pwa
- **Expect:** funding.ui.mode === "fundcard", preferredFundingRail === "FUND_CARD" when enabled
- **Pass criteria:** "Add money" opens FundCard modal via session token. Close modal triggers refresh bridge + poll (NO_CHANGE) up to 60s.

**3) Waiting-for-funds banner precedence**

- **Given:** miniapp + wallet ready + funding enabled
- **When:** lastRefreshAt > 3 minutes AND (observed - accounted) >= $1, and no commit_pending or needs_input banner
- **Expect:** today.banner.type === "waiting_for_funds"
- **Pass criteria:** If a higher priority banner exists, it wins. Banner clears once refresh credits funds.

**4) Push deeplink routing**

- **Given:** reminder deeplink to /?focus=challenge&userChallengeId=...
- **Expect:** If PWA tab already open: notification click focuses tab and navigates in-app (no new tab). Page scrolls + highlights target card or active challenge.
- **Pass criteria:** Router receives NAVIGATE message and routes correctly. Cross-origin URLs ignored.

**5) Auth returnTo**

- Visit /history unauthenticated → redirected to /login?returnTo=%2Fhistory
- After magic link → /auth/success?returnTo=%2Fhistory → redirects back

---

## 5) Production config checklist

- **AUTH_PEPPER** set (required)
- **APP_ORIGIN** set to PWA origin
- **API_ORIGIN** set to API origin
- **Funding:** FUNDING_PROVIDER=coinbase, CDP_PROJECT_ID, CDP_API_KEY, Base chain constants (e.g., chainId 8453)
- **Miniapp deeplink:** optional MINIAPP_FUND_DEEPLINK
- **Push:** PUSH_ENABLED=true, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
- **Email:** EMAIL_PROVIDER=resend, RESEND_API_KEY, EMAIL_FROM
