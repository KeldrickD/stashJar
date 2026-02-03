"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { getUserId, setUserId as saveUserId, clearUserId } from "@/lib/session";

function fmt(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function Home() {
  const [userId, setUser] = useState<string | null>(null);
  const [stashAccountId, setStashAccountId] = useState<string | null>(null);
  const [balanceCents, setBalanceCents] = useState<number>(0);
  const [tier, setTier] = useState<string>("NORMIE");
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<string>("");

  const [depositDollars, setDepositDollars] = useState("10");
  const [withdrawDollars, setWithdrawDollars] = useState("5");

  const advancedVisible = useMemo(
    () => flags.show_view_onchain || flags.show_powered_by_base_badge,
    [flags],
  );

  async function boot() {
    setStatus("Loading…");

    let uid = getUserId();
    if (!uid) {
      const created = await api.createUser();
      uid = created.userId;
      saveUserId(uid);
    }

    setUser(uid);

    const accounts = await api.getAccounts(uid);
    const stash = accounts.userAccounts.find((a: any) => a.type === "USER_STASH");
    setStashAccountId(stash.id);

    const bal = await api.getBalance(stash.id);
    setBalanceCents(bal.balanceCents ?? 0);

    const f = await api.getFlags(uid);
    setTier(f.tier);
    setFlags(f.flags);

    setStatus("");
  }

  async function refresh() {
    if (!stashAccountId) return;
    const bal = await api.getBalance(stashAccountId);
    setBalanceCents(bal.balanceCents ?? 0);
  }

  useEffect(() => {
    void boot();
  }, []);

  async function doDeposit() {
    if (!userId) return;
    setStatus("Creating deposit…");
    const amountCents = Math.round(Number(depositDollars) * 100);
    const pi = await api.createDeposit(userId, amountCents);

    setStatus("Settling deposit…");
    await api.settleDeposit(pi.paymentIntent?.id ?? pi.id);
    await refresh();
    setStatus("");
  }

  async function doWithdraw() {
    if (!userId) return;
    setStatus("Requesting withdrawal…");
    const amountCents = Math.round(Number(withdrawDollars) * 100);
    const pi = await api.requestWithdraw(userId, amountCents);

    setStatus("Marking paid…");
    await api.markWithdrawPaid(pi.id);
    await refresh();
    setStatus("");
  }

  async function resetUser() {
    clearUserId();
    location.reload();
  }

  return (
    <main className="mx-auto max-w-xl p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold">My Stash Jar</h1>
        <p className="text-sm opacity-70">Tier: {tier}</p>
      </header>

      <section className="rounded-xl border p-5 space-y-3">
        <div className="text-sm opacity-70">Stash Balance</div>
        <div className="text-4xl font-bold">{fmt(balanceCents)}</div>
        {status && <div className="text-sm opacity-70">{status}</div>}
      </section>

      <section className="rounded-xl border p-5 space-y-4">
        <h2 className="text-xl font-semibold">Add to Stash</h2>
        <div className="flex gap-2 items-center">
          <input
            value={depositDollars}
            onChange={(e) => setDepositDollars(e.target.value)}
            className="border rounded px-3 py-2 w-28"
            inputMode="decimal"
          />
          <button onClick={doDeposit} className="rounded bg-black text-white px-4 py-2">
            Add
          </button>
        </div>
        <p className="text-xs opacity-70">(MVP: we simulate instant settlement)</p>
      </section>

      <section className="rounded-xl border p-5 space-y-4">
        <h2 className="text-xl font-semibold">Withdraw</h2>
        <div className="flex gap-2 items-center">
          <input
            value={withdrawDollars}
            onChange={(e) => setWithdrawDollars(e.target.value)}
            className="border rounded px-3 py-2 w-28"
            inputMode="decimal"
          />
          <button onClick={doWithdraw} className="rounded bg-black text-white px-4 py-2">
            Withdraw
          </button>
        </div>
      </section>

      <section className="rounded-xl border p-5 space-y-3">
        <h2 className="text-xl font-semibold">Challenges</h2>
        <div className="grid grid-cols-1 gap-2">
          <a className="underline" href="/challenges">
            Go to Challenges
          </a>
          <a className="underline" href="/history">
            View History
          </a>
        </div>
      </section>

      {advancedVisible && (
        <section className="rounded-xl border p-5 space-y-2">
          <h2 className="text-xl font-semibold">Advanced</h2>
          {flags.show_powered_by_base_badge && (
            <div className="text-sm">Powered by Base (hidden for normies)</div>
          )}
          {flags.show_view_onchain && (
            <div className="text-sm opacity-70">Onchain view will live here in Step 20.</div>
          )}
        </section>
      )}

      <footer className="text-xs opacity-60">
        User: {userId ?? "…"} •{" "}
        <button onClick={resetUser} className="underline">
          Reset local user
        </button>
      </footer>
    </main>
  );
}
