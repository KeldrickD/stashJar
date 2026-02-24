# Contributing

## Principles
- Server is the source of truth (no tier-string checks in UI).
- Idempotency everywhere.
- Normie-safe UX by default.

## Setup
- Install dependencies for:
  - `services/ledger-service`
  - `apps/pwa`
  - `services/onchain-service` (if running worker)
- Configure `.env` files (see `docs/DEPLOYMENT.md`).

## Running locally
### ledger-service
- Run Postgres
- `npx prisma migrate dev`
- `npx prisma generate`
- start server

### PWA
- `npm run dev` (or your package manager)
- ensure `NEXT_PUBLIC_API_BASE` points to ledger-service

## Code style
- No `any` in touched files; use `unknown` + narrowing.
- Prefer server-driven actions/limits.
- Keep error bodies typed; daily_limit must include `nextAllowedAt`.

## PR checklist
- [ ] Tests pass
- [ ] TypeScript build passes
- [ ] Lint is clean for touched files
- [ ] Docs updated if API contracts changed
