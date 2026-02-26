# StashJar – Full setup guide

Follow this to get the PWA and API running end-to-end (Vercel + Railway + Postgres).

---

## 1. Backend on Railway

### 1.1 Create project and Postgres

1. Go to [railway.app](https://railway.app) and create a new project.
2. Add **Postgres**: in the project, click **+ New** → **Database** → **PostgreSQL**. Railway will create a DB and set `DATABASE_URL` when you add the app.
3. Add the **app** from this repo: **+ New** → **GitHub Repo** → select this repository. Railway will add a service from the repo root.

### 1.2 Configure the API service

1. Open the **service** that was created from the repo (not the Postgres service).
2. **Root Directory:** In **Settings** → **Source**, set **Root Directory** to:
   ```text
   services/ledger-service
   ```
3. **Variables:** In **Variables**, add (or use “Add from Postgres” so `DATABASE_URL` is set automatically):

   **Required:**

   | Variable        | Example / notes |
   |-----------------|------------------|
   | `DATABASE_URL` | From Railway Postgres (or your own Postgres URL). |
   | `AUTH_PEPPER`   | Long random string, e.g. `openssl rand -hex 32`. |
   | `APP_ORIGIN`    | PWA URL, e.g. `https://stashjar.vercel.app`. |
   | `API_ORIGIN`    | This API’s public URL, e.g. `https://YOUR-APP.up.railway.app` (see step 1.3). |

   **Optional (for full features):**

   - Email: `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`
   - Funding: `FUNDING_PROVIDER=coinbase`, `CDP_PROJECT_ID`, `CDP_API_KEY`, `RPC_URL`, `USDC_ADDRESS`
   - Push: `PUSH_ENABLED=true`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`

   See **DEPLOYMENT.md** for the full list.

4. **Migrations:** Run once (from your machine or Railway’s shell) with the same `DATABASE_URL`:
   ```bash
   cd services/ledger-service && npx prisma migrate deploy
   ```
   Or add a **release command** in Railway that runs: `npx prisma migrate deploy` (so each deploy runs migrations).

### 1.3 Get the API URL

1. In the API service, go to **Settings** → **Networking** → **Generate Domain** (or use the default one).
2. Copy the public URL, e.g. `https://stashjar-api.up.railway.app`.
3. Set **`API_ORIGIN`** in this service’s Variables to that URL (no trailing slash).
4. Confirm **`APP_ORIGIN`** is set to your PWA URL (e.g. `https://stashjar.vercel.app`).

### 1.4 Deploy and check

- Push to the connected branch or trigger a deploy. Build runs: `npm ci && npm run build`; start: `npm start`.
- Open `https://YOUR-API-URL/health` – you should see `{"ok":true}`.

---

## 2. PWA on Vercel

### 2.1 Deploy the app

1. In [Vercel](https://vercel.com), import this repo (or use the existing stashjar project).
2. **Root Directory:** Set to `apps/pwa` (if the project uses the monorepo root, set it in the project settings).
3. Build and deploy. The app will be at e.g. `https://stashjar.vercel.app`.

### 2.2 Point the PWA at your API

1. In the Vercel project → **Settings** → **Environment Variables**.
2. Add:
   - **Name:** `NEXT_PUBLIC_API_BASE`
   - **Value:** Your Railway API URL **with no trailing slash**, e.g. `https://stashjar-api.up.railway.app`
3. **Redeploy** so the new value is used. After that, the config banner should disappear and login/API calls will use your backend.

---

## 3. Smoke test

1. Open the PWA URL (e.g. `https://stashjar.vercel.app`).
2. No yellow “set NEXT_PUBLIC_API_BASE” banner.
3. Try **Sign in with wallet** or **email magic link**; after redirect you should be logged in and the app should work.

---

## 4. Optional: run migrations on every deploy

In Railway, for the API service:

- **Settings** → **Deploy** → set **Release Command** to:
  ```bash
  npx prisma migrate deploy
  ```
  Then each deploy will apply pending migrations before starting the app.

---

## Quick reference

| What              | Where / value |
|-------------------|----------------|
| API root dir      | `services/ledger-service` |
| PWA root dir      | `apps/pwa` |
| API health        | `GET /health` → `{"ok":true}` |
| Env for PWA       | `NEXT_PUBLIC_API_BASE` = Railway API URL |
| Env for API       | `DATABASE_URL`, `AUTH_PEPPER`, `APP_ORIGIN`, `API_ORIGIN` (see DEPLOYMENT.md) |

Do **not** commit secrets or API keys; use Railway and Vercel environment variables only.
