# Deployment Guide – StashJar

## Architecture

- **PWA** → Hosted (Vercel / Cloudflare / custom)
- **API** → Node server (Fly.io / Railway / Render / VPS)
- **DB** → PostgreSQL
- **Chain** → Base (8453)
- **Email** → Resend
- **Push** → Web Push (VAPID)

---

## Environment Variables (API)

**Required:**

- `DATABASE_URL=`
- `AUTH_PEPPER=`
- `APP_ORIGIN=`
- `API_ORIGIN=`

**Funding:**

- `FUNDING_PROVIDER=coinbase`
- `CDP_PROJECT_ID=`
- `CDP_API_KEY=`
- `RPC_URL=`
- `USDC_ADDRESS=`

**MiniApp:**

- `MINIAPP_FUND_DEEPLINK=` (optional)

**Push:**

- `PUSH_ENABLED=true`
- `VAPID_PUBLIC_KEY=`
- `VAPID_PRIVATE_KEY=`
- `VAPID_SUBJECT=`

**Email:**

- `EMAIL_PROVIDER=resend`
- `RESEND_API_KEY=`
- `EMAIL_FROM=`

---

## Railway (recommended)

- **Root Directory:** `services/ledger-service`
- **Build:** `npm ci && npm run build` (see `services/ledger-service/railway.toml`)
- **Start:** `npm start`
- **Env:** Set `DATABASE_URL`, `AUTH_PEPPER`, `APP_ORIGIN`, `API_ORIGIN` (and optional Resend, CDP, VAPID). Link Postgres in the same project to get `DATABASE_URL`.
- **Migrations:** Run `npx prisma migrate deploy` once (or set as Railway **Release Command**).
- **PWA:** In Vercel set `NEXT_PUBLIC_API_BASE` to the Railway API URL (no trailing slash) and redeploy.

Full step-by-step: **SETUP.md**.

---

## Deploy Backend

```bash
pnpm build
pnpm prisma migrate deploy
pnpm start
```

## Deploy PWA

Ensure:

- HTTPS enabled
- Service worker accessible at `/sw.js`
- API origin allowed via CORS with credentials

---

## Production Checks

Before go-live:

- [ ] `/health` returns OK
- [ ] `/debug/health/chain` returns OK
- [ ] Funding refresh works
- [ ] Withdraw path works (POWER)
- [ ] Push subscription works
- [ ] MiniApp funding deeplink opens wallet
- [ ] Return-from-wallet bridge credits funds
