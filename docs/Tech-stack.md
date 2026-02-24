# Tech Stack — StashJar

## Backend
- Node.js + TypeScript
- Fastify (HTTP server)
- Prisma (Postgres ORM + migrations)
- Zod (env + request validation)
- viem (chain reads for USDC balance)
- web-push (push notifications)
- Resend (email)

## Onchain / Worker
- onchain-service worker loops:
  - allocate / reconcile / withdraw-request / redeem / mark
  - watchdog for stuck SUBMITTED actions

## Frontend (PWA)
- Next.js (App Router)
- TypeScript
- Minimal component architecture (TodayCardRenderer, card components)
- Service Worker for push + in-app navigation bridging

## Funding rails
- PWA: embedded wallet + FundCard/FundButton (Coinbase tooling) when configured
- Miniapp: “open in wallet” deeplink + return-to-app refresh bridge
- Backend bridge: `POST /users/:id/funding/refresh`

## Environments
- Dev: hardhat chain, deterministic wallet provider
- Prod: Base mainnet (chainId 8453), real smart wallet provider, real funding session minting
