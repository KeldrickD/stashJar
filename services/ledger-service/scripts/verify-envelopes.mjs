const BASE = "http://localhost:4001";

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

(async () => {
  console.log("1) Seeding templates...");
  // seed endpoint expects either no body or valid JSON; send minimal empty object
  await j("POST", "/debug/seed/challenges", {});

  console.log("2) Creating user...");
  const { userId } = await j("POST", "/users", {});
  const accounts = await j("GET", `/users/${userId}/accounts`);
  const stash = accounts.userAccounts.find((a) => a.type === "USER_STASH");
  assert(stash, "USER_STASH account missing");

  console.log("3) Starting 100 envelopes challenge...");
  const start = await j("POST", "/challenges/start", {
    userId,
    templateSlug: "100_envelopes",
    startDate: new Date().toISOString(),
  });
  const challengeId = start.userChallengeId;
  assert(challengeId, "challengeId missing");

  console.log("4) Drawing 20 envelopes, settling deposits, ensuring uniqueness...");
  const seen = new Set();
  let totalCents = 0;

  for (let i = 0; i < 20; i++) {
    const draw = await j("POST", `/challenges/${challengeId}/draw`, {});
    assert(draw.envelope >= 1 && draw.envelope <= 100, "envelope out of range");
    assert(!seen.has(draw.envelope), "duplicate envelope drawn");
    seen.add(draw.envelope);

    assert(draw.amountCents === draw.envelope * 100, "amountCents mismatch for envelope");
    assert(draw.paymentIntentId, "paymentIntentId missing from draw response");

    // settle it
    await j("POST", "/webhooks/deposits/settled", { paymentIntentId: draw.paymentIntentId });
    totalCents += draw.amountCents;
  }

  console.log("5) Checking stash balance equals total settled...");
  const bal = await j("GET", `/ledger/accounts/${stash.id}/balance`);
  assert(
    bal.balanceCents === totalCents,
    `balance mismatch: got ${bal.balanceCents}, expected ${totalCents}`,
  );

  console.log("✅ Envelope challenge partial run verified (20 draws).");

  console.log("6) Starting dice challenge...");
  const diceStart = await j("POST", "/challenges/start", {
    userId,
    templateSlug: "dice",
    startDate: new Date().toISOString(),
  });
  const diceId = diceStart.userChallengeId;
  assert(diceId, "dice challengeId missing");

  console.log("7) Dice roll sanity (10 rolls)...");
  for (let i = 0; i < 10; i++) {
    const roll = await j("POST", `/challenges/${diceId}/roll`, {});
    assert(roll.roll >= 1 && roll.roll <= 6, "dice roll out of range");
  }

  console.log("✅ Dice endpoint sanity passed.");
})();
