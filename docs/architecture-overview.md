# System Architecture Overview – StashJar

Below is a system-level architecture diagram.

```mermaid
flowchart TD
  subgraph Client Layer
    A[PWA - Next.js]
    B[MiniApp WebView - Frames/MiniKit]
    SW[Service Worker]
  end

  subgraph API Layer
    API[ledger-service - Node + Express]
  end

  subgraph Workers
    PUSH[Push Reminder Job]
    CRON[Weekly Recap Cron]
    WATCH[Onchain Watchdog]
  end

  subgraph Data Layer
    DB[(PostgreSQL)]
  end

  subgraph External Services
    CDP[Coinbase CDP / FundCard]
    BASE[Base Blockchain]
    EMAIL[Resend Email]
    PUSHNET[Web Push Network]
  end

  A -->|REST + Cookies| API
  B -->|REST + Cookies| API
  SW -->|Push Event| A

  API --> DB
  API -->|Read USDC Balance| BASE
  API -->|Create Session Token| CDP
  API -->|Send Email| EMAIL
  API -->|Send Push| PUSHNET

  PUSH --> DB
  PUSH --> API
  PUSH --> PUSHNET

  CRON --> DB
  CRON --> EMAIL

  WATCH --> BASE
  WATCH --> DB

  CDP --> BASE

  PUSHNET --> SW
```

## Architecture Notes

**Client Layer** — Same app serves PWA + MiniApp. Mode driven by server context. Service Worker handles push + navigation.

**API Layer** — Single source of truth for: funding rails, limits, tier permissions, challenge due windows, idempotent ledger entries.

**Workers** — Push reminder job, weekly recap cron, onchain watchdog.

**Data** — Postgres is authoritative. Ledger integrity verified via `/debug/health/ledger`.

**External Systems** — Coinbase CDP for funding sessions; Base for USDC balances; Resend for email; Web Push network for notifications.
