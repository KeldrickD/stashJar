# StashJar Documentation

Welcome to the StashJar project documentation.

StashJar is a dual-mode savings platform:

- **Progressive Web App (PWA)**
- **Base Mini App (Frames / MiniKit style)**

The backend is the single source of truth for:

- Funding rails
- Tier permissions
- Daily limits
- Challenge rules
- Reminder routing
- Onchain reconciliation

---

## 📌 Start Here

If you're new to the project, follow this order:

### 0️⃣ System Architecture

**[architecture-overview.md](./architecture-overview.md)**  
High-level system diagram (Mermaid): client layer, API, workers, data, external services.

### 1️⃣ Product Vision & Requirements

**[PRD.md](./PRD.md)**

Defines:

- The problem StashJar solves
- User tiers (Normie → DEV)
- Core features
- Funding model
- Success metrics

This explains *what* we are building and *why*.

### 2️⃣ Overall Project Roadmap

**[project_plan.md](./project_plan.md)**

Outlines:

- Development phases
- Production hardening
- Growth strategy
- Scaling roadmap

This explains *where* we're going.

### 3️⃣ Backend Architecture

**[backend-structure.md](./backend-structure.md)**  
Covers:

- Domain boundaries (Auth, Funding, Challenges, Reminders)
- Core models
- Worker jobs
- Onchain integration

**[ERD.md](./ERD.md)**  
Database entity-relationship diagrams (Mermaid).

This explains *how* data flows and persists.

### 4️⃣ API Contract

**[APIs.md](./APIs.md)**

Defines:

- Auth endpoints
- Home/config contract
- Funding session + refresh
- Withdraw
- Challenge settings
- Cron jobs

Frontend must follow these contracts strictly. **Server is authoritative.**

### 5️⃣ Application Flow

**[app-flow.md](./app-flow.md)**

Covers:

- PWA funding flow
- MiniApp funding flow
- Return-from-wallet bridge
- Push notification routing

Includes sequence diagrams.

### 6️⃣ MiniApp Integration

**[miniapp-packaging.md](./miniapp-packaging.md)**

Includes:

- Frames / MiniKit setup checklist
- Context rules
- Deeplink contract
- Test matrix
- Production config checklist

Read this when embedding into Base or Farcaster environments.

### 7️⃣ Security Model

**[security_model.md](./security_model.md)**

Covers:

- Threat model
- Auth hardening
- Funding abuse prevention
- Rate limits
- Idempotency
- Onchain safety
- Push safety

Defines how the system protects user funds and accounts.

### 8️⃣ Observability & Production Ops

**[observability.md](./observability.md)**

Includes:

- Logging standards
- Error taxonomy
- Health checks
- Metrics to chart
- Suggested dashboards
- Operational runbooks

Read this before going live.

---

## 📦 Frontend Architecture

**[Frontend-guidelines.md](./Frontend-guidelines.md)**  
Defines:

- Server-driven UI rules
- Funding rail handling
- No tier-string checks
- Countdown component usage
- Deep link handling rules

**[File-structure.md](./File-structure.md)**  
Explains:

- `apps/pwa` layout
- `ledger-service` structure
- Where major features live

---

## 🔐 Core Principles (TL;DR)

- **Server is source of truth.**
- Funding rail is derived only from `funding.ui.mode`.
- No UI logic based on tier strings.
- All limits enforced server-side.
- All deep links are relative paths.
- Only refetch home when necessary (SETTLED-only in funding bridge).
- Every financial action is idempotent.

---

## 🧠 Recommended Reading Order

If you're onboarding a new engineer:

1. architecture-overview.md  
2. PRD.md  
3. project_plan.md  
4. backend-structure.md  
5. ERD.md  
6. APIs.md  
7. app-flow.md  
8. security_model.md  
9. observability.md  
10. miniapp-packaging.md  
