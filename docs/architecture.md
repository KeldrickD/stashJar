# Architecture Overview (System-level)

```mermaid
flowchart LR
  subgraph Client
    PWA[PWA (Next.js)]
    SW[Service Worker\nPush + NAVIGATE]
    Mini[Miniapp WebView Shell\n?context=miniapp]
  end

  subgraph Backend
    API[ledger-service\nFastify + Prisma]
    DB[(Postgres)]
    PushW[Push Worker\n(remindable scan)]
    EmailW[Email sender\n(Resend)]
  end

  subgraph Onchain
    RPC[Base RPC]
    Vault[USDC Vault\n(onchain)]
    OC[onchain-service\nWorker + Watchdog]
  end

  PWA -->|cookie auth| API
  Mini -->|cookie auth + context| API
  SW --> PWA

  API --> DB
  API --> RPC
  API -->|mint session| EmailW
  PushW -->|web-push| SW

  API -->|intents + ledger| DB
  OC -->|reconcile/withdraw/mark| RPC
  OC --> Vault
  API -->|read USDC balance| RPC

  PWA -->|funding session| API
  PWA -->|funding refresh bridge| API
  Mini -->|open wallet deeplink| Vault
```

## Notes
- ledger-service is the product’s source of truth for:
  - today cards, banners, streaks, actions, limits, due windows
- onchain-service executes vault operations and keeps mark-to-market fresh
- Funding is “credit by observation”:
  - user funds wallet address
  - API reads USDC balance and credits stash via idempotent refresh bridge
