# Contributing to StashJar

Thank you for contributing.

StashJar is a production-grade savings platform with real money flows. Contributions must respect:

- Server authority
- Funding safety
- Idempotency
- Rate limits
- Tier-based gating
- MiniApp + PWA dual-mode behavior

---

## Development Setup

**Backend**

```bash
cd services/ledger-service
pnpm install
pnpm prisma migrate dev
pnpm dev
```

**PWA**

```bash
cd apps/pwa
pnpm install
pnpm dev
```

---

## Required Standards

### 1️⃣ Server is source of truth

- No tier-string checks in frontend.
- All limits must be enforced server-side.
- UI must follow `config.actions` and `funding.ui`.

### 2️⃣ Financial actions must be idempotent

- Challenge commits require idempotency keys.
- Funding refresh must not double-credit.
- Withdraw must not double-execute.

### 3️⃣ Error codes are stable contracts

Do not change: `daily_limit`, `rate_limit`, `forbidden`, `wallet_not_ready`, etc. Add new error codes only if necessary.

---

## Pull Request Checklist

- [ ] No tier-string checks added in frontend.
- [ ] Server validation mirrors UI validation.
- [ ] All financial paths idempotent.
- [ ] Rate limits preserved.
- [ ] No cross-origin deeplinks.
- [ ] Docs updated if API changed.

---

## Code Review Philosophy

We prioritize:

- **Safety** over convenience.
- **Deterministic behavior** over cleverness.
- **Clear contracts** over implicit logic.
- **Backend validation** over frontend trust.
