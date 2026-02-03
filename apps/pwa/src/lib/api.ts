const API = process.env.NEXT_PUBLIC_API_BASE!;

async function req<T>(method: string, path: string, body?: any): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!res.ok) throw new Error(typeof data === "string" ? data : JSON.stringify(data));
  return data as T;
}

export const api = {
  createUser: () => req<{ userId: string }>("POST", "/users", {}),

  getAccounts: (userId: string) => req<any>("GET", `/users/${userId}/accounts`),

  getBalance: (accountId: string) =>
    req<{ balanceCents: number }>("GET", `/ledger/accounts/${accountId}/balance`),

  getFlags: (userId: string) =>
    req<{ tier: string; flags: Record<string, boolean> }>("GET", `/users/${userId}/flags`),

  getTxHistory: (userId: string) =>
    req<{
      transactions: Array<{ occurredAt: string; type: string; amountCents: number; memo?: string }>;
    }>("GET", `/users/${userId}/transactions`),

  startChallenge: (userId: string, templateSlug: string) =>
    req<{ userChallengeId: string; nextRunAt?: string }>("POST", "/challenges/start", {
      userId,
      templateSlug,
      startDate: new Date().toISOString(),
    }),

  runDueChallenges: () => req<any>("POST", "/challenges/run-due", {}),

  drawEnvelope: (challengeId: string) =>
    req<any>("POST", `/challenges/${challengeId}/draw`, {}),

  rollDice: (challengeId: string) => req<any>("POST", `/challenges/${challengeId}/roll`, {}),

  createDeposit: (userId: string, amountCents: number) =>
    req<any>("POST", "/payments/deposits", {
      userId,
      amountCents,
      idempotencyKey: `pwa_dep_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    }),

  settleDeposit: (paymentIntentId: string) =>
    req<any>("POST", "/webhooks/deposits/settled", { paymentIntentId }),

  requestWithdraw: (userId: string, amountCents: number) =>
    req<any>("POST", "/payments/withdrawals", {
      userId,
      amountCents,
      idempotencyKey: `pwa_wd_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    }),

  markWithdrawPaid: (paymentIntentId: string) =>
    req<any>("POST", "/webhooks/withdrawals/paid", { paymentIntentId }),
};
