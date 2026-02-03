const BASE = "http://localhost:4001";
const runKey = `yield_test_${Date.now()}`;

async function j(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) {
    console.error("REQUEST FAILED:", method, path, data);
    process.exit(1);
  }
  return data;
}

function assert(cond, msg) {
  if (!cond) {
    console.error("ASSERT FAILED:", msg);
    process.exit(1);
  }
}

async function getBalance(accountId) {
  const bal = await j("GET", `/ledger/accounts/${accountId}/balance`);
  return bal.balanceCents;
}

(async () => {
  console.log("1) Seed challenges (no-op if present)...");
  await j("POST", "/debug/seed/challenges", {});

  console.log("2) Create users A and B...");
  const { userId: userA } = await j("POST", "/users", {});
  const { userId: userB } = await j("POST", "/users", {});

  const accountsA = await j("GET", `/users/${userA}/accounts`);
  const accountsB = await j("GET", `/users/${userB}/accounts`);

  const stashA = accountsA.userAccounts.find((a) => a.type === "USER_STASH");
  const stashB = accountsB.userAccounts.find((a) => a.type === "USER_STASH");
  assert(stashA && stashB, "stash accounts missing");

  console.log("3) Fund treasury with $100 (10000 cents)...");
  await j("POST", "/admin/treasury/fund", {
    amountCents: 10000,
    idempotencyKey: "fund_0001",
  });

  console.log("4) Deposit to user A: $1000; user B: $500...");
  const depA = await j("POST", "/payments/deposits", {
    userId: userA,
    amountCents: 100000,
    idempotencyKey: `depA_${runKey}`,
  });
  await j("POST", "/webhooks/deposits/settled", { paymentIntentId: depA.paymentIntent.id });

  const depB = await j("POST", "/payments/deposits", {
    userId: userB,
    amountCents: 50000,
    idempotencyKey: `depB_${runKey}`,
  });
  await j("POST", "/webhooks/deposits/settled", { paymentIntentId: depB.paymentIntent.id });

  const stashBefore = await j("GET", "/debug/stash-balances");
  const balA0 = await getBalance(stashA.id);
  const balB0 = await getBalance(stashB.id);
  console.log("Balances before yield:", { balA0, balB0 });

  const allocPlan = computeAllocations(
    stashBefore.accounts,
    300,
    (a) => a.userId,
  );

  console.log("5) Run yield accrual for $300 total...");
  const accrue = await j("POST", "/admin/yield/accrue", {
    runKey,
    periodStart: "2026-01-26T00:00:00.000Z",
    periodEnd: "2026-02-02T00:00:00.000Z",
    totalYieldCents: 300,
  });
  console.log("Yield accrue response:", accrue);

  const stashAfter = await j("GET", "/debug/stash-balances");
  const balA1 = await getBalance(stashA.id);
  const balB1 = await getBalance(stashB.id);

  console.log("Balances after yield:", { balA1, balB1 });

  const expectedA = allocPlan.byUser[userA] ?? 0;
  const expectedB = allocPlan.byUser[userB] ?? 0;

  assert(
    balA1 - balA0 === expectedA,
    `User A yield expected ${expectedA}, got ${balA1 - balA0}`,
  );
  assert(
    balB1 - balB0 === expectedB,
    `User B yield expected ${expectedB}, got ${balB1 - balB0}`,
  );

  console.log("✅ Yield accrual verified");
})();

function computeAllocations(accounts, totalYieldCents, getUserId) {
  const positive = accounts.filter((a) => a.balanceCents > 0);
  const sumWeights = positive.reduce((s, a) => s + a.balanceCents, 0);
  const allocs = positive.map((a) => {
    const raw = (totalYieldCents * a.balanceCents) / sumWeights;
    const amt = Math.floor(raw);
    return { userId: getUserId(a), amt, frac: raw - amt, balance: a.balanceCents };
  });
  let allocated = allocs.reduce((s, a) => s + a.amt, 0);
  let leftover = totalYieldCents - allocated;
  allocs.sort((a, b) => {
    const fracDiff = b.frac - a.frac;
    if (fracDiff !== 0) return fracDiff;
    const balDiff = b.balance - a.balance;
    if (balDiff !== 0) return balDiff;
    return a.userId.localeCompare(b.userId);
  });
  for (let i = 0; i < allocs.length && leftover > 0; i++) {
    allocs[i].amt += 1;
    leftover -= 1;
  }
  const byUser = {};
  for (const a of allocs) byUser[a.userId] = a.amt;
  return { allocs, byUser, leftover };
}
