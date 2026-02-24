# Deployment — StashJar

## Environments
- Dev: localhost, hardhat chain optional, deterministic wallet provider
- Prod: HTTPS, Base mainnet, real wallet provider + CDP funding

## Required services
- Postgres (ledger-service)
- ledger-service
- onchain-service (worker + watchdog)
- PWA hosting (Next)

## Environment variables (high level)
### ledger-service
- AUTH_PEPPER
- APP_ORIGIN, API_ORIGIN
- SESSION_TTL_DAYS, SESSION_RENEW_WINDOW_DAYS
- RESEND_API_KEY, EMAIL_FROM, EMAIL_PROVIDER=resend
- VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, PUSH_ENABLED=true
- FUNDING_PROVIDER=coinbase
- CDP_PROJECT_ID, CDP_API_KEY
- RPC_URL, USDC_ADDRESS, CHAIN_ID=8453
- MINIAPP_FUND_DEEPLINK (optional)

### onchain-service
- RPC URL, chain config, vault address, usdc address
- worker intervals
- watchdog thresholds

## Migrations
From `services/ledger-service`:
- `npx prisma migrate deploy`
- `npx prisma generate`

## Health checks
- GET /health
- GET /debug/health/ledger
- Monitor request timing logs

## Cron / Jobs
- Weekly recap: `POST /cron/weekly-recap` (guard with CRON_SECRET)
- Push worker runs internally on interval (if enabled)

## Rollout checklist
- [ ] Domain + TLS
- [ ] Resend domain verified (SPF/DKIM)
- [ ] VAPID keys present
- [ ] CDP keys present (if using FundCard)
- [ ] RPC stable (Base)
- [ ] Database backups enabled
