# File Structure – StashJar

## apps/pwa

```
app/
  page.tsx
  challenges/page.tsx
components/
  FundingCta.tsx
  DiceCard.tsx
  EnvelopesCard.tsx
  TodayCardRenderer.tsx
  SwNavigateListener.tsx
lib/
  api.ts
public/
  sw.js
docs/
  miniapp-packaging.md
```

## services/ledger-service

```
src/
  server.ts
  lib/
    fundingProvider.ts
    fundingLimits.ts
    chainRead.ts
    walletProvider.ts
    challengeDue.ts
prisma/
  schema.prisma
  migrations/
```
