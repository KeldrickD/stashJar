import "dotenv/config";
import Fastify from "fastify";
import { PrismaClient, AccountType, EntryType, UserTier } from "./generated/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { z } from "zod";
import { resolveFlags } from "./lib/tier";
import { isAddress } from "viem";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });
const app = Fastify({ logger: true });

async function getSystemAccountId(type: AccountType) {
  const acc = await prisma.account.findFirst({
    where: { userId: null, type },
  });
  if (!acc) throw new Error(`Missing system account: ${type}`);
  return acc.id;
}

async function getUserStashAccountId(userId: string) {
  const acc = await prisma.account.findFirst({
    where: { userId, type: AccountType.USER_STASH },
  });
  if (!acc) throw new Error(`Missing USER_STASH for user: ${userId}`);
  return acc.id;
}

function dayOfWeekToNumber(dow: string): number {
  const v = dow.trim().toUpperCase();
  if (v === "SUN") return 0;
  if (v === "MON") return 1;
  if (v === "TUE") return 2;
  if (v === "WED") return 3;
  if (v === "THU") return 4;
  if (v === "FRI") return 5;
  if (v === "SAT") return 6;
  throw new Error(`Invalid dayOfWeek: ${dow}`);
}

function yyyymmddUtc(d: Date) {
  const iso = d.toISOString().slice(0, 10); // YYYY-MM-DD
  return iso.replaceAll("-", "");
}

async function commitChallengeEvent(params: {
  userId: string;
  userChallengeId: string;
  challengeEventId: string;
}) {
  const { userId, userChallengeId, challengeEventId } = params;
  const idempo = `challenge_dep_${challengeEventId}`;

  const ce = await prisma.challengeEvent.findUnique({
    where: { id: challengeEventId },
    include: { userChallenge: true },
  });
  if (!ce) throw new Error("Challenge event not found");
  if (ce.userChallengeId !== userChallengeId) throw new Error("Challenge mismatch");
  if (ce.userChallenge?.userId !== userId) throw new Error("User mismatch");

  if (ce.paymentIntentId) {
    return { paymentIntentId: ce.paymentIntentId, status: "ALREADY_COMMITTED" };
  }

  const amountCents = ce.amountCents;
  if (!amountCents || amountCents <= 0) throw new Error("Invalid amount");

  const pendingDepositId = await getSystemAccountId(AccountType.PENDING_DEPOSIT);
  const externalClearingId = await getSystemAccountId(AccountType.EXTERNAL_CLEARING);
  const userStashId = await getUserStashAccountId(userId);

  const pi = await prisma.$transaction(async (tx) => {
    let existing = await tx.paymentIntent.findUnique({ where: { idempotencyKey: idempo } });

    if (!existing) {
      const jeInit = await tx.journalEntry.create({
        data: {
          idempotencyKey: `je_${idempo}_init`,
          type: EntryType.DEPOSIT_INITIATED,
          metadata: { source: "challenge", challengeEventId, userChallengeId, amountCents },
          lines: {
            create: [
              { accountId: pendingDepositId, amountCents, memo: "Challenge deposit initiated" },
              { accountId: externalClearingId, amountCents: -amountCents, memo: "Awaiting funds" },
            ],
          },
        },
      });

      existing = await tx.paymentIntent.create({
        data: {
          userId,
          type: "DEPOSIT",
          status: "PROCESSING",
          amountCents,
          idempotencyKey: idempo,
          initiatedEntryId: jeInit.id,
          metadata: { source: "challenge", challengeEventId, userChallengeId },
        },
      });
    }

    if (existing.status !== "SETTLED") {
      const jeSettle = await tx.journalEntry.create({
        data: {
          idempotencyKey: `je_${idempo}_settle`,
          type: EntryType.DEPOSIT_SETTLED,
          metadata: { source: "challenge", challengeEventId, userChallengeId },
          lines: {
            create: [
              { accountId: userStashId, amountCents, memo: "Challenge deposit settled" },
              { accountId: pendingDepositId, amountCents: -amountCents, memo: "Release pending deposit" },
            ],
          },
        },
      });

      existing = await tx.paymentIntent.update({
        where: { id: existing.id },
        data: { status: "SETTLED", settledEntryId: jeSettle.id },
      });
    }

    await tx.challengeEvent.update({
      where: { id: ce.id },
      data: {
        paymentIntentId: existing.id,
        metadata: { ...(ce.metadata as any), committedAt: new Date().toISOString() },
      },
    });

    return existing;
  });

  return { paymentIntentId: pi.id, status: pi.status };
}

async function createDepositIntentAndLedger(params: {
  userId: string;
  amountCents: number;
  idempotencyKey: string; // payment intent idempo
  metadata?: any;
}) {
  const { userId, amountCents, idempotencyKey, metadata } = params;

  const existing = await prisma.paymentIntent.findUnique({
    where: { idempotencyKey },
  });
  if (existing) return existing;

  const pendingDepositId = await getSystemAccountId(AccountType.PENDING_DEPOSIT);
  const externalClearingId = await getSystemAccountId(
    AccountType.EXTERNAL_CLEARING,
  );

  return prisma.$transaction(async (tx) => {
    const je = await tx.journalEntry.create({
      data: {
        idempotencyKey: `je_${idempotencyKey}_initiated`,
        type: EntryType.DEPOSIT_INITIATED,
        metadata: { userId, amountCents, ...metadata },
        lines: {
          create: [
            {
              accountId: pendingDepositId,
              amountCents,
              memo: "Deposit initiated",
            },
            {
              accountId: externalClearingId,
              amountCents: -amountCents,
              memo: "Awaiting funds",
            },
          ],
        },
      },
    });

    const pi = await tx.paymentIntent.create({
      data: {
        userId,
        type: "DEPOSIT",
        status: "PROCESSING",
        amountCents,
        idempotencyKey,
        initiatedEntryId: je.id,
        metadata,
      },
    });

    return pi;
  });
}

const PostEntrySchema = z.object({
  idempotencyKey: z.string().min(8),
  type: z.enum([
    "DEPOSIT_INITIATED",
    "DEPOSIT_SETTLED",
    "WITHDRAW_REQUESTED",
    "WITHDRAW_PAID",
    "YIELD_ACCRUED",
    "FEE_CHARGED",
    "REVERSAL",
  ]),
  occurredAt: z.string().datetime().optional(),
  metadata: z.any().optional(),
  lines: z
    .array(
      z.object({
        accountId: z.string().uuid(),
        amountCents: z
          .number()
          .int()
          .refine((v) => v !== 0, {
            message: "amountCents must be non-zero",
          }),
        memo: z.string().optional(),
      }),
    )
    .min(2),
});

app.get("/health", async () => ({ ok: true }));

// Create a user + their stash account + system accounts (if missing)
app.post("/users", async () => {
  const user = await prisma.user.create({ data: {} });

  // user stash
  await prisma.account.create({
    data: { userId: user.id, type: AccountType.USER_STASH },
  });

  // create required system accounts if not exist
  const systemTypes: AccountType[] = [
    AccountType.PENDING_DEPOSIT,
    AccountType.PENDING_WITHDRAW,
    AccountType.EXTERNAL_CLEARING,
    AccountType.TREASURY_USDC,
    AccountType.FEES_REVENUE,
  ];

  for (const t of systemTypes) {
    const exists = await prisma.account.findFirst({
      where: { userId: null, type: t },
    });
    if (!exists) {
      await prisma.account.create({ data: { userId: null, type: t } });
    }
  }

  return { userId: user.id };
});

// Post a journal entry (idempotent, atomic, must sum to 0)
app.post("/ledger/entries", async (req, reply) => {
  const parsed = PostEntrySchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.flatten() });
  }

  const data = parsed.data;
  const net = data.lines.reduce((s, l) => s + l.amountCents, 0);
  if (net !== 0) {
    return reply
      .code(400)
      .send({ error: "Journal entry lines must sum to 0.", net });
  }

  // idempotency: if exists, return existing
  const existing = await prisma.journalEntry.findUnique({
    where: { idempotencyKey: data.idempotencyKey },
    include: { lines: true },
  });
  if (existing) return existing;

  const occurredAt = data.occurredAt ? new Date(data.occurredAt) : new Date();

  try {
    const created = await prisma.$transaction(async (tx) => {
      // create entry + lines atomically
      const entry = await tx.journalEntry.create({
        data: {
          idempotencyKey: data.idempotencyKey,
            type: data.type as EntryType,
          occurredAt,
            metadata: data.metadata ?? undefined,
          lines: {
            create: data.lines.map((l) => ({
              accountId: l.accountId,
              amountCents: l.amountCents,
              memo: l.memo,
            })),
          },
        },
        include: { lines: true },
      });
      return entry;
    });

    return created;
  } catch (err: any) {
    app.log.error(err);
    return reply.code(500).send({ error: err.message, stack: err.stack });
  }
});

// Get account balance
app.get("/ledger/accounts/:accountId/balance", async (req, reply) => {
  const accountId = (req.params as any).accountId as string;

  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return reply.code(404).send({ error: "Account not found" });

  const agg = await prisma.journalLine.aggregate({
    where: { accountId },
    _sum: { amountCents: true },
  });

  return {
    accountId,
    type: account.type,
    currency: account.currency,
    balanceCents: agg._sum.amountCents ?? 0,
  };
});

// Utility: list a user's accounts
app.get("/users/:userId/accounts", async (req, reply) => {
  const userId = (req.params as any).userId as string;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { accounts: true },
  });
  if (!user) return reply.code(404).send({ error: "User not found" });

  const systemAccounts = await prisma.account.findMany({
    where: { userId: null },
  });

  return { userId, userAccounts: user.accounts, systemAccounts };
});

const CreateDepositSchema = z.object({
  userId: z.string().uuid(),
  amountCents: z.number().int().positive().max(500_000), // $5,000 cap for now
  idempotencyKey: z.string().min(8),
});

app.post("/payments/deposits", async (req, reply) => {
  const parsed = CreateDepositSchema.safeParse(req.body);
  if (!parsed.success)
    return reply.code(400).send({ error: parsed.error.flatten() });

  const { userId, amountCents, idempotencyKey } = parsed.data;

  try {
    const pi = await createDepositIntentAndLedger({
      userId,
      amountCents,
      idempotencyKey,
    });

    const userStashId = await getUserStashAccountId(userId);

    return {
      paymentIntent: pi,
      initiatedEntryId: pi.initiatedEntryId,
      userStashAccountId: userStashId,
    };
  } catch (err: any) {
    return reply.code(500).send({ error: err.message });
  }
});

const SettleDepositSchema = z.object({
  paymentIntentId: z.string().uuid(),
  provider: z.string().optional(),
  providerRef: z.string().optional(),
});

app.post("/webhooks/deposits/settled", async (req, reply) => {
  const parsed = SettleDepositSchema.safeParse(req.body);
  if (!parsed.success)
    return reply.code(400).send({ error: parsed.error.flatten() });

  const { paymentIntentId, provider, providerRef } = parsed.data;

  const pi = await prisma.paymentIntent.findUnique({
    where: { id: paymentIntentId },
  });
  if (!pi) return reply.code(404).send({ error: "PaymentIntent not found" });

  if (pi.status === "SETTLED") return pi;

  const userStashId = await getUserStashAccountId(pi.userId);
  const pendingDepositId = await getSystemAccountId(AccountType.PENDING_DEPOSIT);

  const idempo = `settle_${pi.id}`;

  const result = await prisma.$transaction(async (tx) => {
    // Create ledger entry: DEPOSIT_SETTLED
    const existingJE = await tx.journalEntry.findUnique({
      where: { idempotencyKey: `je_${idempo}` },
    });
    let jeId = existingJE?.id;

    if (!existingJE) {
      const je = await tx.journalEntry.create({
        data: {
          idempotencyKey: `je_${idempo}`,
              type: EntryType.DEPOSIT_SETTLED,
              metadata: { paymentIntentId: pi.id, provider, providerRef },
          lines: {
            create: [
              {
                accountId: userStashId,
                amountCents: pi.amountCents,
                memo: "Deposit settled",
              },
              {
                accountId: pendingDepositId,
                amountCents: -pi.amountCents,
                memo: "Release pending",
              },
            ],
          },
        },
      });
      jeId = je.id;
    }

    const updated = await tx.paymentIntent.update({
      where: { id: pi.id },
      data: {
        status: "SETTLED",
        provider: provider ?? pi.provider,
        providerRef: providerRef ?? pi.providerRef,
        settledEntryId: jeId,
      },
    });

    return updated;
  });

  return result;
});

const WithdrawRequestSchema = z.object({
  userId: z.string().uuid(),
  amountCents: z.number().int().positive(),
  idempotencyKey: z.string().min(8),
});

const WithdrawWalletSchema = z.object({
  userId: z.string().uuid(),
  amountCents: z.number().int().min(100, "Minimum $1.00"),
  recipient: z.string().refine((val) => isAddress(val), {
    message: "Invalid EVM address",
  }),
  idempotencyKey: z.string().min(8),
});

app.post("/payments/withdrawals", async (req, reply) => {
  const parsed = WithdrawRequestSchema.safeParse(req.body);
  if (!parsed.success)
    return reply.code(400).send({ error: parsed.error.flatten() });

  const { userId, amountCents, idempotencyKey } = parsed.data;

  const existing = await prisma.paymentIntent.findUnique({
    where: { idempotencyKey },
  });
  if (existing) return existing;

  const userStashId = await getUserStashAccountId(userId);
  const pendingWithdrawId = await getSystemAccountId(
    AccountType.PENDING_WITHDRAW,
  );

  // Ensure user has balance
  const agg = await prisma.journalLine.aggregate({
    where: { accountId: userStashId },
    _sum: { amountCents: true },
  });
  const bal = agg._sum.amountCents ?? 0;
  if (bal < amountCents)
    return reply
      .code(400)
      .send({ error: "Insufficient balance", balanceCents: bal });

  const created = await prisma.$transaction(async (tx) => {
    // WITHDRAW_REQUESTED: DR Pending Withdraw +amount, CR User Stash -amount
    const je = await tx.journalEntry.create({
      data: {
        idempotencyKey: `je_${idempotencyKey}_withdrawal`,
        type: EntryType.WITHDRAW_REQUESTED,
        metadata: { userId, amountCents },
        lines: {
          create: [
            {
              accountId: pendingWithdrawId,
              amountCents: amountCents,
              memo: "Withdraw requested",
            },
            {
              accountId: userStashId,
              amountCents: -amountCents,
              memo: "Reserve funds",
            },
          ],
        },
      },
    });

    const pi = await tx.paymentIntent.create({
      data: {
        userId,
        type: "WITHDRAW",
        status: "PROCESSING",
        amountCents,
        idempotencyKey,
        initiatedEntryId: je.id,
      },
    });

    return pi;
  });

  return created;
});

app.post("/users/:userId/withdraw/wallet", async (req, reply) => {
  const pathUserId = (req.params as any).userId as string;
  const parsed = WithdrawWalletSchema.safeParse({ ...req.body, userId: pathUserId });
  if (!parsed.success)
    return reply.code(400).send({ error: parsed.error.flatten() });

  const { userId, amountCents, recipient, idempotencyKey } = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return reply.code(404).send({ error: "User not found" });

  const flags = resolveFlags(user.tier as any, user.flags);
  if (!flags.enableOnchainWithdrawToWallet) {
    return reply.code(403).send({ error: "Onchain withdraw not enabled for user" });
  }

  // Rate limits
  const now = new Date();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const cooldownAgo = new Date(Date.now() - 30 * 1000);

  const recent = await prisma.paymentIntent.findMany({
    where: {
      userId,
      type: "WITHDRAW",
      createdAt: { gte: dayAgo },
      metadata: { path: ["rail"], equals: "ONCHAIN" },
    },
    orderBy: { createdAt: "desc" },
  });

  if (recent[0] && recent[0].createdAt >= cooldownAgo) {
    return reply.code(429).send({ error: "cooldown", retryAfterSeconds: 30 });
  }

  if (recent.length >= 3) {
    return reply.code(429).send({ error: "daily_limit_count", limit: 3 });
  }

  const used = recent.reduce((s, r) => s + r.amountCents, 0);
  if (used + amountCents > 50_000) {
    return reply
      .code(429)
      .send({ error: "daily_limit_amount", limitCents: 50_000, usedCents: used });
  }

  const existing = await prisma.paymentIntent.findUnique({ where: { idempotencyKey } });
  if (existing) return existing;

  const userStashId = await getUserStashAccountId(userId);
  const pendingWithdrawId = await getSystemAccountId(AccountType.PENDING_WITHDRAW);

  const agg = await prisma.journalLine.aggregate({
    where: { accountId: userStashId },
    _sum: { amountCents: true },
  });
  const bal = agg._sum.amountCents ?? 0;
  if (bal < amountCents)
    return reply.code(400).send({ error: "Insufficient balance", balanceCents: bal });

  const created = await prisma.$transaction(async (tx) => {
    const je = await tx.journalEntry.create({
      data: {
        idempotencyKey: `je_${idempotencyKey}_withdraw_wallet`,
        type: EntryType.WITHDRAW_REQUESTED,
        metadata: { userId, amountCents, rail: "ONCHAIN", recipient },
        lines: {
          create: [
            { accountId: pendingWithdrawId, amountCents, memo: "Withdraw to wallet requested" },
            { accountId: userStashId, amountCents: -amountCents, memo: "Reserve funds" },
          ],
        },
      },
    });

    const pi = await tx.paymentIntent.create({
      data: {
        userId,
        type: "WITHDRAW",
        status: "PROCESSING",
        amountCents,
        idempotencyKey,
        initiatedEntryId: je.id,
        metadata: { rail: "ONCHAIN", recipient },
      },
    });

    return pi;
  });

  return created;
});

const WithdrawPaidSchema = z.object({
  paymentIntentId: z.string().uuid(),
  provider: z.string().optional(),
  providerRef: z.string().optional(),
});

app.post("/webhooks/withdrawals/paid", async (req, reply) => {
  const parsed = WithdrawPaidSchema.safeParse(req.body);
  if (!parsed.success)
    return reply.code(400).send({ error: parsed.error.flatten() });

  const { paymentIntentId, provider, providerRef } = parsed.data;

  const pi = await prisma.paymentIntent.findUnique({
    where: { id: paymentIntentId },
  });
  if (!pi) return reply.code(404).send({ error: "PaymentIntent not found" });
  if (pi.status === "SETTLED") return pi; // treat paid as settled for withdrawals

  const pendingWithdrawId = await getSystemAccountId(
    AccountType.PENDING_WITHDRAW,
  );
  const externalClearingId = await getSystemAccountId(
    AccountType.EXTERNAL_CLEARING,
  );

  const idempo = `withdraw_paid_${pi.id}`;

  const updated = await prisma.$transaction(async (tx) => {
    const existingJE = await tx.journalEntry.findUnique({
      where: { idempotencyKey: `je_${idempo}` },
    });
    let jeId = existingJE?.id;

    if (!existingJE) {
      const je = await tx.journalEntry.create({
        data: {
          idempotencyKey: `je_${idempo}`,
          type: EntryType.WITHDRAW_PAID,
          metadata: { paymentIntentId: pi.id, provider, providerRef },
          lines: {
            create: [
              {
                accountId: externalClearingId,
                amountCents: pi.amountCents,
                memo: "Payout sent",
              },
              {
                accountId: pendingWithdrawId,
                amountCents: -pi.amountCents,
                memo: "Clear pending withdrawal",
              },
            ],
          },
        },
      });
      jeId = je.id;
    }

    return tx.paymentIntent.update({
      where: { id: pi.id },
      data: {
        status: "SETTLED",
        provider: provider ?? pi.provider,
        providerRef: providerRef ?? pi.providerRef,
        settledEntryId: jeId,
      },
    });
  });

  return updated;
});

app.get("/users/:userId/transactions", async (req, reply) => {
  const userId = (req.params as any).userId as string;
  const stashId = await getUserStashAccountId(userId);

  const lines = await prisma.journalLine.findMany({
    where: { accountId: stashId },
    include: { entry: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const txs = lines.map((l) => ({
    occurredAt: l.entry.occurredAt,
    type: l.entry.type,
    amountCents: l.amountCents,
    memo: l.memo ?? null,
    entryId: l.entryId,
    metadata: (l.entry as any).metadata ?? null,
  }));

  return { userId, transactions: txs };
});

// --- Treasury funding (dev/admin) ---
const FundTreasurySchema = z.object({
  amountCents: z.number().int().positive(),
  idempotencyKey: z.string().min(8),
});

app.post("/admin/treasury/fund", async (req, reply) => {
  const parsed = FundTreasurySchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

  const { amountCents, idempotencyKey } = parsed.data;
  const treasuryId = await getSystemAccountId(AccountType.TREASURY_USDC);
  const externalClearingId = await getSystemAccountId(AccountType.EXTERNAL_CLEARING);

  const existingJE = await prisma.journalEntry.findUnique({ where: { idempotencyKey } });
  if (existingJE) return existingJE;

  const created = await prisma.journalEntry.create({
    data: {
      idempotencyKey,
      type: EntryType.TREASURY_FUNDED,
      metadata: { note: "Treasury funded (dev)" },
      lines: {
        create: [
          { accountId: treasuryId, amountCents, memo: "Treasury funded" },
          { accountId: externalClearingId, amountCents: -amountCents, memo: "External source" },
        ],
      },
    },
  });

  return created;
});

// --- Yield accrual (dev/admin) ---
const YieldAccrueSchema = z.object({
  runKey: z.string().min(6),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  totalYieldCents: z.number().int().positive(),
});

app.post("/admin/yield/accrue", async (req, reply) => {
  const parsed = YieldAccrueSchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

  const { runKey, periodStart, periodEnd, totalYieldCents } = parsed.data;

  const existingRun = await prisma.yieldRun.findUnique({ where: { runKey } });
  if (existingRun && existingRun.status === "POSTED") return existingRun;

  const treasuryId = await getSystemAccountId(AccountType.TREASURY_USDC);
  const treBalAgg = await prisma.journalLine.aggregate({
    where: { accountId: treasuryId },
    _sum: { amountCents: true },
  });
  const treasuryBal = treBalAgg._sum.amountCents ?? 0;
  if (treasuryBal < totalYieldCents) {
    return reply.code(400).send({
      error: "Treasury balance insufficient to distribute yield",
      treasuryBal,
      required: totalYieldCents,
    });
  }

  const run =
    existingRun ??
    (await prisma.yieldRun.create({
      data: {
        runKey,
        periodStart: new Date(periodStart),
        periodEnd: new Date(periodEnd),
        totalYieldCents,
        status: "CREATED",
      },
    }));

  const users = await prisma.user.findMany({ include: { accounts: true } });

  const balances: { userId: string; stashId: string; bal: number }[] = [];
  for (const u of users) {
    const stash = u.accounts.find((a) => a.type === AccountType.USER_STASH);
    if (!stash) continue;
    const agg = await prisma.journalLine.aggregate({
      where: { accountId: stash.id },
      _sum: { amountCents: true },
    });
    const bal = agg._sum.amountCents ?? 0;
    if (bal > 0) balances.push({ userId: u.id, stashId: stash.id, bal });
  }

  const sumWeights = balances.reduce((s, b) => s + b.bal, 0);
  if (sumWeights <= 0) {
    return reply.code(400).send({ error: "No positive balances found to allocate yield" });
  }

  let allocated = 0;
  const allocs = balances.map((b) => {
    const raw = (totalYieldCents * b.bal) / sumWeights;
    const amt = Math.floor(raw);
    allocated += amt;
    return { ...b, amt, frac: raw - amt };
  });

  let leftover = totalYieldCents - allocated;
  allocs.sort((a, b) => {
    const fracDiff = b.frac - a.frac;
    if (fracDiff !== 0) return fracDiff;
    const balDiff = b.bal - a.bal;
    if (balDiff !== 0) return balDiff;
    return a.userId.localeCompare(b.userId);
  });
  for (let i = 0; i < allocs.length && leftover > 0; i++) {
    allocs[i].amt += 1;
    leftover -= 1;
  }

  let totalAllocated = 0;
  let allocatedUsers = 0;

  await prisma.$transaction(async (tx) => {
    for (const a of allocs) {
      if (a.amt <= 0) continue;

      const idempo = `yield_${runKey}_${a.userId}`;
      const existingAlloc = await tx.yieldAllocation.findUnique({
        where: { idempotencyKey: idempo },
      });
      if (existingAlloc) {
        totalAllocated += existingAlloc.amountCents;
        allocatedUsers += 1;
        continue;
      }

      await tx.journalEntry.create({
        data: {
          idempotencyKey: `je_${idempo}`,
          type: EntryType.YIELD_ACCRUED,
          metadata: { runKey, userId: a.userId, stashId: a.stashId },
          lines: {
            create: [
              { accountId: treasuryId, amountCents: -a.amt, memo: "Yield distributed" },
              { accountId: a.stashId, amountCents: a.amt, memo: "Stash grew" },
            ],
          },
        },
      });

      await tx.yieldAllocation.create({
        data: {
          yieldRunId: run.id,
          userId: a.userId,
          userStashAccountId: a.stashId,
          amountCents: a.amt,
          idempotencyKey: idempo,
        },
      });

      totalAllocated += a.amt;
      allocatedUsers += 1;
    }

    await tx.yieldRun.update({
      where: { id: run.id },
      data: { status: "POSTED" },
    });
  });

  return {
    ok: true,
    runKey,
    totalYieldCents,
    totalAllocated,
    allocatedUsers,
    leftover,
  };
});

app.get("/debug/stash-balances", async () => {
  const accounts = await prisma.account.findMany({
    where: { type: AccountType.USER_STASH },
    select: { id: true, userId: true },
  });

  const results = [];
  for (const acc of accounts) {
    const agg = await prisma.journalLine.aggregate({
      where: { accountId: acc.id },
      _sum: { amountCents: true },
    });
    results.push({
      userId: acc.userId ?? null,
      accountId: acc.id,
      balanceCents: agg._sum.amountCents ?? 0,
    });
  }
  return { count: results.length, accounts: results };
});

// --- Feature flags & tiers (dev/admin) ---
app.post("/debug/seed/flags", async () => {
  const flags = [
    {
      key: "show_powered_by_base_badge",
      description: "Show Powered by Base badge",
      defaultEnabled: false,
    },
    {
      key: "show_view_onchain",
      description: "Show View onchain controls",
      defaultEnabled: false,
    },
    {
      key: "enable_self_custody_mode",
      description: "Allow smart wallet export/self-custody UI",
      defaultEnabled: false,
    },
    {
      key: "show_receipts",
      description: "Show onchain receipts/proofs",
      defaultEnabled: false,
    },
    {
      key: "show_yield_details_basic",
      description: "Show basic yield explainer",
      defaultEnabled: false,
    },
    {
      key: "show_yield_details_advanced",
      description: "Show advanced strategy breakdown",
      defaultEnabled: false,
    },
    {
      key: "enable_power_staking",
      description: "Enable power-user staking (approved assets)",
      defaultEnabled: false,
    },
  ];

  for (const f of flags) {
    await prisma.featureFlag.upsert({
      where: { key: f.key },
      update: { description: f.description, defaultEnabled: f.defaultEnabled },
      create: f,
    });
  }

  const policies = [
    // CURIOUS
    { tier: UserTier.CURIOUS, flagKey: "show_powered_by_base_badge", enabled: true },
    { tier: UserTier.CURIOUS, flagKey: "show_yield_details_basic", enabled: true },

    // POWER
    { tier: UserTier.POWER, flagKey: "show_powered_by_base_badge", enabled: true },
    { tier: UserTier.POWER, flagKey: "show_view_onchain", enabled: true },
    { tier: UserTier.POWER, flagKey: "show_receipts", enabled: true },
    { tier: UserTier.POWER, flagKey: "show_yield_details_basic", enabled: true },
    { tier: UserTier.POWER, flagKey: "show_yield_details_advanced", enabled: true },
    { tier: UserTier.POWER, flagKey: "enable_power_staking", enabled: true },
  ];

  for (const p of policies) {
    await prisma.tierPolicy.upsert({
      where: { tier_flagKey: { tier: p.tier, flagKey: p.flagKey } },
      update: { enabled: p.enabled },
      create: p,
    });
  }

  return { ok: true };
});

app.get("/users/:userId/flags", async (req, reply) => {
  const userId = (req.params as any).userId as string;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { flagOverrides: true },
  });
  if (!user) return reply.code(404).send({ error: "User not found" });

  const allFlags = await prisma.featureFlag.findMany();
  const tierPolicies = await prisma.tierPolicy.findMany({
    where: { tier: user.tier },
  });

  const baseMap = new Map(allFlags.map((f) => [f.key, f.defaultEnabled]));
  for (const p of tierPolicies) baseMap.set(p.flagKey, p.enabled);
  for (const o of user.flagOverrides) baseMap.set(o.flagKey, o.enabled);

  return {
    userId,
    tier: user.tier,
    flags: Object.fromEntries(baseMap.entries()),
  };
});

const SetTierSchema = z.object({
  userId: z.string().uuid(),
  tier: z.nativeEnum(UserTier),
});

app.post("/admin/users/set-tier", async (req, reply) => {
  const parsed = SetTierSchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

  const u = await prisma.user.update({
    where: { id: parsed.data.userId },
    data: { tier: parsed.data.tier },
  });

  return { ok: true, userId: u.id, tier: u.tier };
});

// --- Challenge Engine v1 ---

app.post("/debug/seed/challenges", async () => {
  const templates = [
    {
      slug: "52_week",
      name: "52-Week Challenge",
      defaultRules: {
        type: "weekly_increment",
        week1AmountCents: 100,
        incrementCents: 100,
        maxWeeks: 52,
        weekday: 1,
        schedule: { type: "weekly", dayOfWeek: "MON", catchUp: true },
      },
    },
    {
      slug: "100_envelopes",
      name: "100 Envelopes Challenge",
      defaultRules: {
        type: "envelopes",
        min: 1,
        max: 100,
        unitAmountCents: 100,
      },
    },
    {
      slug: "dice",
      name: "Roll-the-Dice",
      defaultRules: {
        type: "dice",
        sides: 6,
        unitAmountCents: 100,
      },
    },
  ];

  for (const t of templates) {
    await prisma.challengeTemplate.upsert({
      where: { slug: t.slug },
      update: {
        name: t.name,
        defaultRules: t.defaultRules as any,
      },
      create: {
        slug: t.slug,
        name: t.name,
        defaultRules: t.defaultRules as any,
      },
    });
  }

  return { ok: true };
});

app.get("/debug/challenges", async () => {
  return prisma.userChallenge.findMany({ include: { template: true, events: true } });
});

app.get("/debug/challenges/:id", async (req, reply) => {
  const id = (req.params as any).id as string;
  const uc = await prisma.userChallenge.findUnique({
    where: { id },
  });
  if (!uc) return reply.code(404).send({ error: "Not found" });
  return { id: uc.id, status: uc.status, state: uc.state, rules: uc.rules };
});

app.get("/debug/users/:userId/payment-intents", async (req, reply) => {
  const userId = (req.params as any).userId as string;
  const paymentIntents = await prisma.paymentIntent.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return { userId, paymentIntents };
});

app.get("/users/:userId/config", async (req, reply) => {
  const userId = (req.params as any).userId as string;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, tier: true, flags: true },
  });
  if (!user) return reply.code(404).send({ error: "User not found" });

  const flags = resolveFlags(user.tier as any, user.flags);
  return { userId: user.id, tier: user.tier, flags };
});

app.get("/users/:userId/stash/value", async (req, reply) => {
  const userId = (req.params as any).userId as string;
  const stashId = await getUserStashAccountId(userId);

  const stashAgg = await prisma.journalLine.aggregate({
    where: { accountId: stashId },
    _sum: { amountCents: true },
  });
  const stashBalanceCents = stashAgg._sum.amountCents ?? 0;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tier: true, flags: true },
  });
  const flags = resolveFlags((user?.tier as any) ?? "NORMIE", user?.flags);

  const vp = await prisma.vaultPosition.findUnique({ where: { userId } });
  const vaultMicros = vp?.currentValueUsdcMicros ? BigInt(vp.currentValueUsdcMicros) : 0n;
  const vaultValueCents = Number(vaultMicros / 10_000n);
  const totalDisplayCents = stashBalanceCents + vaultValueCents;

  const resp: any = {
    userId,
    stashBalanceCents,
    vaultValueCents,
    totalDisplayCents,
    lastMarkedAt: vp?.lastMarkedAt ?? null,
  };

  if (vp?.lastMarkedAt) {
    const ageMs = Date.now() - vp.lastMarkedAt.getTime();
    resp.markAgeSeconds = Math.floor(ageMs / 1000);
    resp.isStale = ageMs > 5 * 60 * 1000; // 5 minutes threshold
  } else {
    resp.markAgeSeconds = null;
    resp.isStale = true;
  }

  if (flags.showVaultShares) {
    resp.vaultShares = vp?.shares ?? null;
    resp.vaultValueUsdcMicros = vp?.currentValueUsdcMicros ?? null;
    resp.vaultAddress = vp?.vaultAddress ?? null;
  }

  if (flags.showChainName || flags.showYieldSource) {
    const latestAction = await prisma.onchainAction.findFirst({
      where: { userId, txHash: { not: null } },
      orderBy: { updatedAt: "desc" },
    });
    if (flags.showChainName) resp.chain = latestAction?.chain ?? null;
    if (flags.showYieldSource) resp.yieldSource = "USDC Vault";
    if (flags.showTxHistory) resp.lastTxHash = latestAction?.txHash ?? null;
  }

  return resp;
});

function toCentsFromMicros(micros?: string | null) {
  if (!micros) return null;
  const v = BigInt(micros);
  return Number(v / 10_000n);
}

function shortAddr(addr?: string | null) {
  if (!addr) return null;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatChallengeDetail(uc?: any, ev?: any) {
  const rules = (uc?.rules as any) ?? (uc?.template as any)?.defaultRules;
  const meta = (ev?.metadata as any) ?? {};
  const type = rules?.type;

  if (type === "envelopes") {
    if (meta.envelope) return `Envelope ${meta.envelope}`;
  } else if (type === "dice") {
    if (meta.roll) return `Rolled ${meta.roll}`;
  } else if (type === "weekly_increment") {
    const wk = meta.weeksSinceStart ?? meta.week ?? meta.weekNumber;
    if (wk) return `Week ${wk}`;
  }

  return null;
}

app.get("/users/:userId/activity", async (req, reply) => {
  const userId = (req.params as any).userId as string;
  const limit = Math.min(Number((req.query as any).limit ?? 50), 100);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { vaultPosition: true },
  });
  if (!user) return reply.code(404).send({ error: "User not found" });

  const flags = resolveFlags(user.tier as any, user.flags);

  const [pis, actions] = await Promise.all([
    prisma.paymentIntent.findMany({
      where: { userId },
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
    flags.showTxHistory
      ? prisma.onchainAction.findMany({
          where: { userId },
          take: limit,
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
  ]);

  const challengePis = pis.filter(
    (pi) => (pi.metadata as any)?.source === "challenge",
  );
  const ucIds = Array.from(
    new Set(
      challengePis
        .map((pi) => (pi.metadata as any)?.userChallengeId as string | undefined)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const evIds = Array.from(
    new Set(
      challengePis
        .map((pi) => (pi.metadata as any)?.challengeEventId as string | undefined)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const [ucs, evs] = await Promise.all([
    ucIds.length
      ? prisma.userChallenge.findMany({
          where: { id: { in: ucIds } },
          include: { template: true },
        })
      : Promise.resolve([]),
    evIds.length
      ? prisma.challengeEvent.findMany({
          where: { id: { in: evIds } },
        })
      : Promise.resolve([]),
  ]);

  const userChallengesById = new Map(ucs.map((x) => [x.id, x]));
  const challengeEventsById = new Map(evs.map((x) => [x.id, x]));

  const events: any[] = [];

  for (const pi of pis) {
    if (pi.type === "DEPOSIT" && pi.status === "SETTLED") {
      const source = (pi.metadata as any)?.source;
      if (source === "challenge") {
        const userChallengeId = (pi.metadata as any)?.userChallengeId;
        const challengeEventId = (pi.metadata as any)?.challengeEventId;
        const uc = userChallengesById.get(userChallengeId);
        const ev = challengeEventsById.get(challengeEventId);
        const name = uc?.name ?? uc?.template?.name ?? "Challenge";
        const detail = formatChallengeDetail(uc, ev);

        events.push({
          id: `pi_${pi.id}`,
          at: pi.updatedAt ?? pi.createdAt,
          category: "challenge",
          title: `Challenge saved $${(pi.amountCents / 100).toFixed(0)}`,
          subtitle: detail ? `${name} • ${detail}` : name,
          amountCents: pi.amountCents,
          meta: {
            challengeSlug: uc?.template?.slug,
            userChallengeId,
            challengeEventId,
          },
        });
        continue;
      }

      events.push({
        id: `pi_${pi.id}`,
        at: pi.updatedAt ?? pi.createdAt,
        category: "deposit",
        title: "Deposit added",
        subtitle: "Added to your stash.",
        amountCents: pi.amountCents,
        meta: {},
      });
    }

    if (pi.type === "WITHDRAW") {
      const rail = (pi.metadata as any)?.rail ?? "BANK";
      const isOnchain = rail === "ONCHAIN";
      const recipient = (pi.metadata as any)?.recipient;

      if (pi.status === "PROCESSING") {
        events.push({
          id: `pi_${pi.id}`,
          at: pi.updatedAt ?? pi.createdAt,
          category: "withdraw",
          title: "Withdrawal requested",
          subtitle: isOnchain
            ? `Sending to ${shortAddr(recipient) ?? "your wallet"}.`
            : "Sending to your bank.",
          amountCents: -pi.amountCents,
          meta:
            flags.enableOnchainWithdrawToWallet && isOnchain && recipient
              ? { recipient }
              : {},
        });
      } else if (pi.status === "SETTLED" || (pi as any).status === "PAID") {
        events.push({
          id: `pi_${pi.id}`,
          at: pi.updatedAt ?? pi.createdAt,
          category: "withdraw",
          title: "Withdrawal completed",
          subtitle: isOnchain
            ? `Sent to ${shortAddr(recipient) ?? "your wallet"}.`
            : "Sent to your bank.",
          amountCents: -pi.amountCents,
          meta: {},
        });
      }
    }
  }

  for (const a of actions as any[]) {
    const meta = (a.metadata as any) ?? {};

    if (a.type === "VAULT_DEPOSIT" && a.status === "CONFIRMED") {
      events.push({
        id: `oa_${a.id}`,
        at: a.updatedAt ?? a.createdAt,
        category: "stash",
        title: flags.showCryptoLabels ? "Vault deposit confirmed" : "Stash is earning",
        subtitle: flags.showCryptoLabels
          ? `shares minted: ${meta?.depositEvent?.sharesMinted ?? "?"}`
          : "Your stash is growing automatically.",
        amountCents: null,
    meta: flags.showTxHistory
      ? {
          txHash: a.txHash,
          chain: a.chain,
          ...(flags.showCryptoLabels
            ? { sharesMinted: meta?.depositEvent?.sharesMinted }
            : {}),
        }
      : {},
      });
    }

    if (a.type === "VAULT_WITHDRAW_REQUEST" && a.status === "CONFIRMED") {
      events.push({
        id: `oa_${a.id}`,
        at: a.updatedAt ?? a.createdAt,
        category: "withdraw",
        title: "Preparing withdrawal",
        subtitle: flags.showCryptoLabels
          ? `requestId: ${a.requestId}`
          : "Getting funds ready.",
        amountCents: null,
    meta: flags.showTxHistory
      ? {
          txHash: a.txHash,
          chain: a.chain,
          ...(flags.showCryptoLabels
            ? { requestId: a.requestId, recipient: meta?.recipient }
            : { recipient: meta?.recipient ? shortAddr(meta.recipient) : undefined }),
        }
      : {},
      });
    }

    if (a.type === "VAULT_REDEEM" && a.status === "CONFIRMED") {
      const usdcAmount = meta?.withdrawRedeemedEvent?.usdcAmount ?? meta?.usdcAmount;
      events.push({
        id: `oa_${a.id}`,
        at: a.updatedAt ?? a.createdAt,
        category: "withdraw",
        title: "Withdrawal funds released",
        subtitle: flags.showCryptoLabels
          ? `usdc: ${usdcAmount ?? "?"}`
          : "Funds released successfully.",
        amountCents: flags.showCryptoLabels && usdcAmount ? toCentsFromMicros(usdcAmount) : null,
    meta: flags.showTxHistory
      ? {
          txHash: a.txHash,
          chain: a.chain,
          ...(flags.showCryptoLabels
            ? { usdcAmount, requestId: meta?.requestId, recipient: meta?.recipient }
            : {}),
        }
      : {},
      });
    }
  }

  if (user.vaultPosition?.lastMarkedAt) {
    events.push({
      id: `mark_${userId}_${new Date(user.vaultPosition.lastMarkedAt).getTime()}`,
      at: user.vaultPosition.lastMarkedAt,
      category: "stash",
      title: "Stash updated",
      subtitle: "Your stash value refreshed.",
      amountCents: null,
      meta: {},
    });
  }

  events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return reply.send({ userId, events: events.slice(0, limit) });
});

const StartChallengeSchema = z.object({
  userId: z.string().uuid(),
  templateSlug: z.string(),
  startDate: z.string().datetime().optional(), // default now
  name: z.string().optional(),
});

function computeNextWeeklyRun(start: Date, weekday: number) {
  // returns next occurrence of given weekday at 09:00 local-ish (weâ€™ll keep UTC for now)
  const d = new Date(start);
  d.setUTCHours(9, 0, 0, 0);

  const currentWeekday = d.getUTCDay();
  const delta = (weekday - currentWeekday + 7) % 7;
  if (delta === 0) return d; // today at 9
  d.setUTCDate(d.getUTCDate() + delta);
  return d;
}

app.post("/challenges/start", async (req, reply) => {
  const parsed = StartChallengeSchema.safeParse(req.body);
  if (!parsed.success)
    return reply.code(400).send({ error: parsed.error.flatten() });

  const { userId, templateSlug } = parsed.data;
  const startDate = parsed.data.startDate
    ? new Date(parsed.data.startDate)
    : new Date();

  const template = await prisma.challengeTemplate.findUnique({
    where: { slug: templateSlug },
  });
  if (!template) return reply.code(404).send({ error: "Template not found" });

  const rules = template.defaultRules as any;
  const autoCommitDefault = rules.autoCommitDefault ?? true;
  const schedule = rules.schedule ?? {};
  const catchUpDefault = schedule.catchUp ?? true;
  const maxCatchUpEventsDefault = schedule.maxCatchUpEvents ?? 30;
  let nextRunAt: Date | null = null;
  let state: any = null;

  if (rules.type === "weekly_increment") {
    nextRunAt = computeNextWeeklyRun(startDate, rules.weekday ?? 1);
  } else if (rules.type === "envelopes") {
    const pool = Array.from(
      { length: (rules.max ?? 100) - (rules.min ?? 1) + 1 },
      (_, i) => (rules.min ?? 1) + i,
    );
    state = {
      remaining: pool,
      used: [],
    };
  }

  const uc = await prisma.userChallenge.create({
    data: {
      userId,
      templateId: template.id,
      name: parsed.data.name ?? template.name,
      startDate,
      rules: rules,
      settings: {
        autoCommit: autoCommitDefault,
        catchUp: catchUpDefault,
        maxCatchUpEvents: maxCatchUpEventsDefault,
      },
      nextRunAt,
      state,
      status: "ACTIVE",
    } as any,
  });

  return { ok: true, userChallengeId: uc.id, nextRunAt, state };
});

app.post("/challenges/run-due", async () => {
  const now = new Date();
  console.log(`[SCHEDULER] Checking due at ${now.toISOString()}`);

  const due = await prisma.userChallenge.findMany({
    where: {
      status: "ACTIVE",
      nextRunAt: { lte: now },
    },
    include: { template: true },
  });
  console.log(`[SCHEDULER] Found ${due.length} due challenges`);

  let processed = 0;

  for (const uc of due) {
    const rules = uc.rules as any;

    // compute "week number" since start (1-based)
    const weeksSinceStart =
      Math.floor(
        (now.getTime() - uc.startDate.getTime()) / (7 * 24 * 3600 * 1000),
      ) + 1;
    if (weeksSinceStart > (rules.maxWeeks ?? 52)) {
      await prisma.userChallenge.update({
        where: { id: uc.id },
        data: { status: "COMPLETED", nextRunAt: null },
      });
      continue;
    }

    const amountCents =
      (rules.week1AmountCents ?? 100) +
      (weeksSinceStart - 1) * (rules.incrementCents ?? 100);
    const scheduledFor = uc.nextRunAt ?? now;

    const eventIdempo = `ch_${uc.id}_${scheduledFor.toISOString()}`;

    // create event idempotently
    const existingEvent = await prisma.challengeEvent.findUnique({
      where: { idempotencyKey: eventIdempo },
    });
    if (existingEvent) {
      // move schedule forward anyway (in case last run died after event creation)
    } else {
      const piIdempo = `dep_${eventIdempo}`;

      const pi = await createDepositIntentAndLedger({
        userId: uc.userId,
        amountCents,
        idempotencyKey: piIdempo,
        metadata: { challengeId: uc.id, weeksSinceStart },
      });

      await prisma.challengeEvent.create({
        data: {
          userChallengeId: uc.id,
          scheduledFor,
          idempotencyKey: `ce_${uc.id}_${scheduledFor.toISOString()}`,
          amountCents,
          result: "DEPOSIT_CREATED",
          paymentIntentId: pi.id,
          metadata: { weeksSinceStart } as any,
        } as any,
      });
    }

    // Advance nextRunAt to next week same weekday 9:00 UTC
    const next = new Date(scheduledFor);
    next.setUTCDate(next.getUTCDate() + 7);

    await prisma.userChallenge.update({
      where: { id: uc.id },
      data: { lastRunAt: scheduledFor, nextRunAt: next },
    });

    processed++;
  }

  return { ok: true, processed };
});

app.post("/users/:userId/challenges/run-due", async (req, reply) => {
  const userId = (req.params as any).userId as string;
  const now = new Date();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tier: true, flags: true },
  });
  if (!user) return reply.code(404).send({ error: "User not found" });

  const rawUserFlags = (user.flags as any) ?? {};
  const dailyCapOverride = rawUserFlags.dailyAutoSaveCapCents;
  const perRunCapOverride = rawUserFlags.perRunAutoSaveCapCents;

  const dailyCapCents =
    typeof dailyCapOverride === "number"
      ? dailyCapOverride
      : user.tier === "POWER" || user.tier === "DEV"
        ? 20_000
        : 5_000;
  const perRunCapCents = typeof perRunCapOverride === "number" ? perRunCapOverride : 20_000;

  const dayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  );
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const todayUsedAgg = await prisma.paymentIntent.aggregate({
    where: {
      userId,
      type: "DEPOSIT",
      status: "SETTLED",
      createdAt: { gte: dayStart, lt: dayEnd },
      metadata: { path: ["source"], equals: "challenge" },
    },
    _sum: { amountCents: true },
  });
  const todayUsedStartCents = todayUsedAgg._sum.amountCents ?? 0;
  let usedCents = todayUsedStartCents;
  let runCommittedCents = 0;

  const skippedCap: Array<{
    eventId: string;
    userChallengeId: string;
    amountCents: number;
    reason: "daily_cap" | "per_run_cap";
  }> = [];

  const ucs = await prisma.userChallenge.findMany({
    where: { userId, status: "ACTIVE" },
    include: { template: true },
    orderBy: { createdAt: "asc" },
  });

  const results: any[] = [];

  for (const uc of ucs) {
    const rules = (uc.rules as any) ?? {};
    if (rules.type !== "weekly_increment") continue;

    const schedule = rules.schedule ?? {};
    const settings = (uc.settings as any) ?? {};

    const catchUp = settings.catchUp ?? schedule.catchUp ?? true;
    const maxCatchUpEvents = Math.max(
      0,
      Number(settings.maxCatchUpEvents ?? schedule.maxCatchUpEvents ?? 30),
    );
    const autoCommit = settings.autoCommit !== false;

    const weekday =
      typeof schedule.dayOfWeek === "string"
        ? dayOfWeekToNumber(schedule.dayOfWeek)
        : Number(rules.weekday ?? 1);

    const firstRun = computeNextWeeklyRun(uc.startDate, weekday);
    const startCursor = uc.lastRunAt
      ? new Date(new Date(uc.lastRunAt).getTime() + 7 * 24 * 3600 * 1000)
      : firstRun;

    const allowed = catchUp ? maxCatchUpEvents : Math.min(1, maxCatchUpEvents || 1);

    let cursor = startCursor;
    let createdEvents = 0;
    let committedEvents = 0;
    let skippedExisting = 0;
    let alreadyCommitted = 0;
    let skippedCapCount = 0;
    let lastScheduled: Date | null = null;

    for (let i = 0; i < allowed && cursor <= now; i++) {
      const dayKey = yyyymmddUtc(cursor);
      const eventIdempo = `sched_${uc.id}_${dayKey}`;

      const existing = await prisma.challengeEvent.findUnique({
        where: { idempotencyKey: eventIdempo },
      });

      let evId: string;
      let amountCents: number;
      if (existing) {
        skippedExisting += 1;
        evId = existing.id;
        amountCents = existing.amountCents;
      } else {
        const weekIndex =
          Math.floor((cursor.getTime() - firstRun.getTime()) / (7 * 24 * 3600 * 1000)) + 1;
        amountCents =
          (rules.week1AmountCents ?? 100) + (weekIndex - 1) * (rules.incrementCents ?? 100);

        const created = await prisma.challengeEvent.create({
          data: {
            userChallengeId: uc.id,
            scheduledFor: cursor,
            idempotencyKey: eventIdempo,
            amountCents,
            result: "DEPOSIT_SCHEDULED",
            metadata: { weeksSinceStart: weekIndex } as any,
          } as any,
        });
        createdEvents += 1;
        evId = created.id;
      }

      if (autoCommit) {
        // If already committed, don't re-run caps or attempt another commit.
        if (existing?.paymentIntentId) {
          alreadyCommitted += 1;
        } else {
          const nextUsed = usedCents + amountCents;
          const nextRun = runCommittedCents + amountCents;

          if (nextUsed > dailyCapCents) {
            skippedCap.push({
              eventId: evId,
              userChallengeId: uc.id,
              amountCents,
              reason: "daily_cap",
            });
            skippedCapCount += 1;
          } else if (nextRun > perRunCapCents) {
            skippedCap.push({
              eventId: evId,
              userChallengeId: uc.id,
              amountCents,
              reason: "per_run_cap",
            });
            skippedCapCount += 1;
          } else {
            const res = await commitChallengeEvent({
              userId: uc.userId,
              userChallengeId: uc.id,
              challengeEventId: evId,
            });

            if (res.status !== "ALREADY_COMMITTED") {
              committedEvents += 1;
              usedCents = nextUsed;
              runCommittedCents = nextRun;
            } else {
              alreadyCommitted += 1;
            }
          }
        }
      }

      if (!autoCommit) {
        // no-op: event exists/created but user disabled autoCommit
      }

      lastScheduled = cursor;
      cursor = new Date(cursor.getTime() + 7 * 24 * 3600 * 1000);
    }

    // Update scheduler pointers (best-effort, idempotent-ish)
    if (lastScheduled) {
      await prisma.userChallenge.update({
        where: { id: uc.id },
        data: {
          lastRunAt: lastScheduled,
          nextRunAt: new Date(lastScheduled.getTime() + 7 * 24 * 3600 * 1000),
        },
      });
    } else if (!uc.lastRunAt) {
      await prisma.userChallenge.update({
        where: { id: uc.id },
        data: { nextRunAt: firstRun },
      });
    }

    results.push({
      userChallengeId: uc.id,
      templateSlug: uc.template?.slug ?? null,
      createdEvents,
      committedEvents,
      skippedExisting,
      alreadyCommitted,
      skippedCap: skippedCapCount,
      lastRunAt: lastScheduled ?? uc.lastRunAt ?? null,
    });
  }

  return reply.send({
    ok: true,
    userId,
    now: now.toISOString(),
    caps: {
      dailyCapCents,
      perRunCapCents,
      todayUsedCents: todayUsedStartCents,
      todayUsedCentsAfter: usedCents,
      runCommittedCents,
    },
    skippedCap,
    results,
  });
});

app.post("/users/:userId/challenges/commit-pending", async (req, reply) => {
  const userId = (req.params as any).userId as string;
  const limit = Math.min(Math.max(Number((req.query as any)?.limit ?? 50), 1), 200);
  const now = new Date();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tier: true, flags: true },
  });
  if (!user) return reply.code(404).send({ error: "User not found" });

  const rawUserFlags = (user.flags as any) ?? {};
  const dailyCapOverride = rawUserFlags.dailyAutoSaveCapCents;
  const perRunCapOverride = rawUserFlags.perRunAutoSaveCapCents;

  const dailyCapCents =
    typeof dailyCapOverride === "number"
      ? dailyCapOverride
      : user.tier === "POWER" || user.tier === "DEV"
        ? 20_000
        : 5_000;
  const perRunCapCents = typeof perRunCapOverride === "number" ? perRunCapOverride : 20_000;

  const dayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  );
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const todayUsedAgg = await prisma.paymentIntent.aggregate({
    where: {
      userId,
      type: "DEPOSIT",
      status: "SETTLED",
      createdAt: { gte: dayStart, lt: dayEnd },
      metadata: { path: ["source"], equals: "challenge" },
    },
    _sum: { amountCents: true },
  });
  const todayUsedStartCents = todayUsedAgg._sum.amountCents ?? 0;
  let usedCents = todayUsedStartCents;
  let runCommittedCents = 0;

  const pending = await prisma.challengeEvent.findMany({
    where: {
      paymentIntentId: null,
      userChallenge: { userId, status: "ACTIVE" },
    },
    orderBy: { scheduledFor: "asc" },
    take: limit,
  });

  const skippedCap: Array<{
    eventId: string;
    userChallengeId: string;
    amountCents: number;
    reason: "daily_cap" | "per_run_cap";
  }> = [];

  let committedCount = 0;
  let committedCents = 0;
  let skippedCapCents = 0;
  let perRunCapHit = false;

  for (const ev of pending) {
    const amountCents = ev.amountCents;
    if (!amountCents || amountCents <= 0) continue;

    const nextUsed = usedCents + amountCents;
    const nextRun = runCommittedCents + amountCents;

    if (nextUsed > dailyCapCents) {
      skippedCap.push({
        eventId: ev.id,
        userChallengeId: ev.userChallengeId,
        amountCents,
        reason: "daily_cap",
      });
      skippedCapCents += amountCents;
      continue;
    }

    if (nextRun > perRunCapCents) {
      skippedCap.push({
        eventId: ev.id,
        userChallengeId: ev.userChallengeId,
        amountCents,
        reason: "per_run_cap",
      });
      skippedCapCents += amountCents;
      perRunCapHit = true;
      break; // stop early; can't commit more this run
    }

    const res = await commitChallengeEvent({
      userId,
      userChallengeId: ev.userChallengeId,
      challengeEventId: ev.id,
    });

    // commitChallengeEvent is idempotent; only count new commits
    if (res.status !== "ALREADY_COMMITTED") {
      committedCount += 1;
      committedCents += amountCents;
      usedCents = nextUsed;
      runCommittedCents = nextRun;
    }
  }

  return reply.send({
    ok: true,
    userId,
    scanned: pending.length,
    committedCount,
    committedCents,
    skippedCapCount: skippedCap.length,
    skippedCapCents,
    perRunCapHit,
    skippedCap,
    caps: {
      dailyCapCents,
      perRunCapCents,
      todayUsedCents: todayUsedStartCents,
      todayUsedCentsAfter: usedCents,
      runCommittedCents,
    },
  });
});

app.post("/challenges/:id/draw", async (req, reply) => {
  const challengeId = (req.params as any).id;

  const uc = await prisma.userChallenge.findUnique({
    where: { id: challengeId },
  });
  if (!uc || uc.status !== "ACTIVE") {
    return reply.code(400).send({ error: "Invalid or inactive challenge" });
  }

  const rules = uc.rules as any;
  const settings = (uc.settings as any) ?? {};
  const state = (uc as any).state as any;

  if (rules.type !== "envelopes") {
    return reply.code(400).send({ error: "Not an envelope challenge" });
  }

  if (!state || state.remaining.length === 0) {
    if (uc.status !== "COMPLETED") {
      await prisma.userChallenge.update({
        where: { id: uc.id },
        data: { status: "COMPLETED" },
      });
    }
    return { done: true };
  }

  // Draw random
  const index = Math.floor(Math.random() * state.remaining.length);
  const envelope = state.remaining[index];
  const amountCents = envelope * (rules.unitAmountCents ?? 100);

  const eventIdempo = `env_${uc.id}_${envelope}`;

  // Idempotency check
  const existing = await prisma.challengeEvent.findUnique({
    where: { idempotencyKey: eventIdempo },
  });
  if (existing) {
    const envMeta = (existing.metadata as any) ?? {};
    let committedPi = existing.paymentIntentId;
    if (!committedPi && (uc.settings as any)?.autoCommit !== false) {
      const res = await commitChallengeEvent({
        userId: uc.userId,
        userChallengeId: uc.id,
        challengeEventId: existing.id,
      });
      committedPi = res.paymentIntentId;
    }
    return {
      envelope: envMeta.envelope ?? envelope,
      amountCents: existing.amountCents,
      remainingCount: state.remaining.length,
      paymentIntentId: committedPi,
    };
  }

  try {
    const pi = await createDepositIntentAndLedger({
      userId: uc.userId,
      amountCents,
      idempotencyKey: `dep_${eventIdempo}`,
      metadata: { challengeId: uc.id, envelope },
    });

    state.remaining.splice(index, 1);
    state.used.push(envelope);

    const ce = await prisma.$transaction(async (tx) => {
      const created = await tx.challengeEvent.create({
        data: {
          userChallengeId: uc.id,
          scheduledFor: new Date(),
          idempotencyKey: eventIdempo,
          amountCents,
          result: "DEPOSIT_CREATED",
          paymentIntentId: pi.id,
          metadata: { envelope } as any,
        } as any,
      });
      await tx.userChallenge.update({
        where: { id: uc.id },
        data: { state } as any,
      });
      return created;
    });

    // Check if that was the last one
    if (state.remaining.length === 0) {
      await prisma.userChallenge.update({
        where: { id: uc.id },
        data: { status: "COMPLETED" },
      });
    }

    let committedPi = pi.id;
    if (settings.autoCommit !== false) {
      const res = await commitChallengeEvent({
        userId: uc.userId,
        userChallengeId: uc.id,
        challengeEventId: (ce as any).id,
      });
      committedPi = res.paymentIntentId;
    }

    return {
      envelope,
      amountCents,
      remainingCount: state.remaining.length,
      paymentIntentId: committedPi,
    };
  } catch (err: any) {
    app.log.error(err);
    return reply.code(500).send({ error: err.message });
  }
});

app.post("/challenges/:id/roll", async (req, reply) => {
  const challengeId = (req.params as any).id;

  const uc = await prisma.userChallenge.findUnique({
    where: { id: challengeId },
  });
  if (!uc || uc.status !== "ACTIVE") {
    return reply.code(400).send({ error: "Invalid or inactive challenge" });
  }

  const rules = uc.rules as any;
  const settings = (uc.settings as any) ?? {};
  if (rules.type !== "dice") {
    return reply.code(400).send({ error: "Not a dice challenge" });
  }

  const roll = Math.floor(Math.random() * (rules.sides ?? 6)) + 1;
  const amountCents = roll * (rules.unitAmountCents ?? 100);

  const eventIdempo = `dice_${uc.id}_${Date.now()}`; // Dice can be rolled many times

  try {
    const pi = await createDepositIntentAndLedger({
      userId: uc.userId,
      amountCents,
      idempotencyKey: `dep_${eventIdempo}`,
      metadata: { challengeId: uc.id, roll },
    });

    const event = await prisma.challengeEvent.create({
      data: {
        userChallengeId: uc.id,
        scheduledFor: new Date(),
        idempotencyKey: eventIdempo,
        amountCents,
        result: "DEPOSIT_CREATED",
        paymentIntentId: pi.id,
        metadata: { roll } as any,
      } as any,
    });

    let committedPi = pi.id;
    if (settings.autoCommit !== false) {
      const res = await commitChallengeEvent({
        userId: uc.userId,
        userChallengeId: uc.id,
        challengeEventId: (event as any).id,
      });
      committedPi = res.paymentIntentId;
    }

    return { roll, amountCents, eventId: (event as any).id, paymentIntentId: committedPi };
  } catch (err: any) {
    app.log.error(err);
    return reply.code(500).send({ error: err.message });
  }
});

app.post("/challenges/:challengeId/events/:eventId/commit", async (req, reply) => {
  const { challengeId, eventId } = req.params as any;

  try {
    const ce = await prisma.challengeEvent.findUnique({
      where: { id: eventId },
      include: { userChallenge: true },
    });
    if (!ce || ce.userChallengeId !== challengeId)
      return reply.code(404).send({ error: "Challenge event not found" });

    const res = await commitChallengeEvent({
      userId: ce.userChallenge!.userId,
      userChallengeId: challengeId,
      challengeEventId: eventId,
    });
    return { paymentIntentId: res.paymentIntentId, status: res.status, amountCents: ce.amountCents };
  } catch (err: any) {
    app.log.error(err);
    return reply.code(500).send({ error: err.message });
  }
});

const port = Number(process.env.PORT ?? 4001);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

