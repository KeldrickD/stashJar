"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { api, type FeatureActions, TodayCard, TodayBanner } from "@/lib/api";
import { getUserId, setUserId as saveUserId, clearUserId } from "@/lib/session";
import { ApplyMissedSavesBanner } from "@/components/ApplyMissedSavesBanner";
import { FundingCta } from "@/components/FundingCta";
import { PushReminderToggle } from "@/components/PushReminderToggle";
import { TodayCardRenderer } from "@/components/TodayCardRenderer";
import { sortTodayCards } from "@/lib/todayOrder";

function fmt(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function getResetsInUtc(): string {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
  const ms = next.getTime() - now.getTime();
  const totalMins = Math.floor(ms / 60000);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const DEFAULT_ACTIONS: FeatureActions = {
  canFund: false,
  canWithdrawToWallet: false,
  canWithdrawToBank: false,
  canDiceTwoDice: false,
  canDiceMultiplier10: false,
  canDiceChooseSides: false,
  canEnvelopesTwoPerDay: false,
  canEnvelopesWeeklyCadence: false,
  canEnvelopesReverseOrder: false,
  canStreakShield: false,
  canMakeupSave: false,
  canPushReminders: false,
  canWeeklyRecapEmail: false,
};

export default function Home() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const homeContext: "pwa" | "miniapp" = searchParams?.get("context") === "miniapp" ? "miniapp" : "pwa";
  const [userId, setUser] = useState<string | null>(null);
  const [stashAccountId, setStashAccountId] = useState<string | null>(null);
  const [balanceCents, setBalanceCents] = useState<number>(0);
  const [tier, setTier] = useState<string>("NORMIE");
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [actions, setActions] = useState<FeatureActions>(DEFAULT_ACTIONS);
  const [status, setStatus] = useState<string>("");
  const [todayCards, setTodayCards] = useState<TodayCard[]>([]);
  const [todayBanner, setTodayBanner] = useState<TodayBanner | undefined>(undefined);
  const [todayError, setTodayError] = useState<string | null>(null);
  const [focusEventId, setFocusEventId] = useState<string | null>(null);
  const [activeChallenges, setActiveChallenges] = useState<
    Array<{ userChallengeId: string; name: string; templateSlug: string | null; progress?: string }>
  >([]);
  const [streak, setStreak] = useState<{
    todayCompleted: boolean;
    currentStreakDays: number;
    bestStreakDays: number;
    lastCompletedDateUtc: string | null;
    streakStatus?: "ok" | "needs_recovery" | "decayed";
    streakShieldAvailable?: boolean;
    recoveryTarget?: number | null;
  } | null>(null);
  const [prevTodayCompleted, setPrevTodayCompleted] = useState<boolean | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [resetsIn, setResetsIn] = useState<string>("");
  const [fundingEnabled, setFundingEnabled] = useState<boolean>(false);
  const [walletReady, setWalletReady] = useState<boolean>(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [lastFundingRefreshAt, setLastFundingRefreshAt] = useState<string | null>(null);
  const [fundingBusy, setFundingBusy] = useState<boolean>(false);
  const [maxCreditsPerDayCents, setMaxCreditsPerDayCents] = useState<number | undefined>(undefined);
  const [fundingUiMode, setFundingUiMode] = useState<"fundcard" | "open_in_wallet">("fundcard");
  const [fundingDeeplink, setFundingDeeplink] = useState<string | undefined>(undefined);
  const [fundingHelperText, setFundingHelperText] = useState<string | undefined>(undefined);

  const [depositDollars, setDepositDollars] = useState("10");
  const [withdrawDollars, setWithdrawDollars] = useState("5");

  const advancedVisible = useMemo(
    () => flags.show_view_onchain || flags.show_powered_by_base_badge,
    [flags],
  );

  const sortedCards = useMemo(() => sortTodayCards(todayCards), [todayCards]);
  const doneForToday = Boolean(
    streak?.todayCompleted && sortedCards.length === 0 && !todayBanner && !todayError,
  );

  async function boot() {
    setStatus("Loading…");
    try {
      const me = await api.getMe();
      const uid = me.userId;
      saveUserId(uid);
      setUser(uid);
      const home = await api.getHome(uid, { context: homeContext });
      setStashAccountId(home.stashAccountId);
      setBalanceCents(home.stash?.totalDisplayCents ?? (home as any).stashBalanceCents ?? 0);
      setFundingEnabled(!!(home as any).funding?.enabled);
      setWalletReady(!!(home as any).wallet?.ready);
      setWalletAddress((home as any).wallet?.address ?? null);
      setLastFundingRefreshAt((home as any).funding?.lastRefreshAt ?? null);
      setMaxCreditsPerDayCents((home as any).funding?.limits?.maxCreditsPerDayCents ?? undefined);
      setFundingUiMode(((home as any).funding?.ui?.mode as "fundcard" | "open_in_wallet" | undefined) ?? "fundcard");
      setFundingDeeplink((home as any).funding?.ui?.deeplink ?? undefined);
      setFundingHelperText((home as any).funding?.ui?.helperText ?? undefined);
      setTier(home.config.tier);
      setFlags(home.config.flags as Record<string, boolean>);
      setActions((home.config.actions as FeatureActions) ?? DEFAULT_ACTIONS);
      setTodayCards(home.today.cards ?? []);
      setTodayBanner(home.today.banner);
      setActiveChallenges(home.activeChallenges ?? []);
      setStreak(home.streak);
      setPrevTodayCompleted(home.streak.todayCompleted);
      setTodayError(null);
      const stored = localStorage.getItem("focusEventId");
      if (stored) setFocusEventId(stored);
    } catch {
      const returnTo = pathname ? encodeURIComponent(pathname) : "";
      router.replace(returnTo ? `/login?returnTo=${returnTo}` : "/login");
      return;
    }
    setStatus("");
  }

  async function ensureWalletThenRefresh() {
    if (!userId) return;
    setFundingBusy(true);
    try {
      await api.walletProvision(userId);
      await refreshEverything();
    } catch (e: any) {
      setToastMsg(e?.message ?? "Wallet setup failed");
    } finally {
      setFundingBusy(false);
    }
  }

  async function addMoneyRefresh(): Promise<
    | { status?: string; createdPaymentIntents?: number; deltaCents?: number }
    | { error: "daily_limit"; retryAfterSeconds: number; nextAllowedAt: string }
    | void
  > {
    if (!userId) return;
    setFundingBusy(true);
    try {
      const res = await api.fundingRefresh(userId, {
        clientContext: { source: "pwa", flow: "fundcard", sessionHint: "fund_v1" },
      });
      const status = res?.result?.status ?? null;
      const created = res?.result?.createdPaymentIntents ?? 0;
      const deltaCents = res?.accounting?.deltaCents ?? res?.accounting?.unallocatedDeltaCents ?? 0;
      return { status: status ?? undefined, createdPaymentIntents: created, deltaCents };
    } catch (e: any) {
      try {
        const msg = e?.message;
        if (typeof msg === "string") {
          const d = JSON.parse(msg) as {
            error?: string;
            retryAfterSeconds?: number;
            nextAllowedAt?: string;
          };
          if (d?.error === "daily_limit" && d.retryAfterSeconds != null && d.nextAllowedAt) {
            return { error: "daily_limit", retryAfterSeconds: d.retryAfterSeconds, nextAllowedAt: d.nextAllowedAt };
          }
        }
      } catch {}
      setToastMsg(e?.message ?? "Refresh failed");
      return undefined;
    } finally {
      setFundingBusy(false);
    }
  }

  async function refresh() {
    if (!stashAccountId) return;
    const bal = await api.getBalance(stashAccountId);
    setBalanceCents(bal.balanceCents ?? 0);
  }

  async function refreshTodayCards(uid?: string) {
    const id = uid ?? userId;
    if (!id) return;
    try {
      setTodayError(null);
      const res = await api.getTodayCards(id);
      setTodayCards(res.cards ?? []);
      setTodayBanner(res.banner);
      const stored = localStorage.getItem("focusEventId");
      if (stored) setFocusEventId(stored);
    } catch (err: any) {
      setTodayError(err?.message ?? "Failed to load today cards");
    }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setStatus("Loading…");

        let uid: string | null = null;
        try {
          const me = await api.getMe();
          if (!alive) return;
          uid = me.userId;
          saveUserId(uid);
        } catch {
          if (!alive) return;
          const returnTo = pathname ? encodeURIComponent(pathname) : "";
          router.replace(returnTo ? `/login?returnTo=${returnTo}` : "/login");
          return;
        }

        if (!alive) return;
        setUser(uid);

        try {
          const home = await api.getHome(uid!, { context: homeContext });
          if (!alive) return;
          setStashAccountId(home.stashAccountId);
          setBalanceCents(home.stash?.totalDisplayCents ?? (home as any).stashBalanceCents ?? 0);
          setFundingEnabled(!!(home as any).funding?.enabled);
          setWalletReady(!!(home as any).wallet?.ready);
          setWalletAddress((home as any).wallet?.address ?? null);
          setLastFundingRefreshAt((home as any).funding?.lastRefreshAt ?? null);
          setMaxCreditsPerDayCents((home as any).funding?.limits?.maxCreditsPerDayCents ?? undefined);
          setFundingUiMode(((home as any).funding?.ui?.mode as "fundcard" | "open_in_wallet" | undefined) ?? "fundcard");
          setFundingDeeplink((home as any).funding?.ui?.deeplink ?? undefined);
          setFundingHelperText((home as any).funding?.ui?.helperText ?? undefined);
          setTier(home.config.tier);
          setFlags(home.config.flags as Record<string, boolean>);
          setActions((home.config.actions as FeatureActions) ?? DEFAULT_ACTIONS);
          setTodayCards(home.today.cards ?? []);
          setTodayBanner(home.today.banner);
          setActiveChallenges(home.activeChallenges ?? []);
          setStreak(home.streak);
          setPrevTodayCompleted(home.streak.todayCompleted);
          setTodayError(null);
          const stored = localStorage.getItem("focusEventId");
          if (stored) setFocusEventId(stored);
        } catch (err: any) {
          if (alive) setTodayError(err?.message ?? "Failed to load home");
          if (alive) setTodayCards([]);
          if (alive) setTodayBanner(undefined);
          if (alive) setActiveChallenges([]);
          if (alive) setStreak(null);
        }

        setStatus("");
      } catch (e: any) {
        if (!alive) return;
        setStatus(e?.message ?? "Failed to load");
      }
    })();
    return () => {
      alive = false;
    };
  }, [router, pathname, homeContext]);

  useEffect(() => {
    if (!focusEventId) return;
    const el = document.getElementById(`card_${focusEventId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const timeout = setTimeout(() => {
      localStorage.removeItem("focusEventId");
      setFocusEventId(null);
    }, 2000);
    return () => clearTimeout(timeout);
  }, [focusEventId, todayCards]);

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 3000);
    return () => clearTimeout(t);
  }, [toastMsg]);

  function maybeShowStreakToast(
    s: { todayCompleted: boolean; currentStreakDays: number },
    prevCompleted: boolean | null,
  ) {
    // Only when we just flipped to completed this session (first completion today)
    if (!s.todayCompleted || s.currentStreakDays < 1) return;
    if (prevCompleted === true) return; // was already completed, don't toast on refresh
    const todayKey = new Date().toISOString().slice(0, 10);
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(`streakToast_${todayKey}`)) return;
    setToastMsg("Streak kept ✅");
    try {
      sessionStorage.setItem(`streakToast_${todayKey}`, "1");
    } catch {}
  }

  async function refreshEverything() {
    const uid = userId;
    if (!uid) return;
    try {
      const home = await api.getHome(uid, { context: homeContext });
      setStashAccountId(home.stashAccountId);
      setBalanceCents(home.stash?.totalDisplayCents ?? (home as any).stashBalanceCents ?? 0);
      setFundingEnabled(!!(home as any).funding?.enabled);
      setWalletReady(!!(home as any).wallet?.ready);
      setWalletAddress((home as any).wallet?.address ?? null);
      setLastFundingRefreshAt((home as any).funding?.lastRefreshAt ?? null);
      setMaxCreditsPerDayCents((home as any).funding?.limits?.maxCreditsPerDayCents ?? undefined);
      setFundingUiMode(((home as any).funding?.ui?.mode as "fundcard" | "open_in_wallet" | undefined) ?? "fundcard");
      setFundingDeeplink((home as any).funding?.ui?.deeplink ?? undefined);
      setFundingHelperText((home as any).funding?.ui?.helperText ?? undefined);
      setTier(home.config.tier);
      setFlags(home.config.flags as Record<string, boolean>);
      setActions((home.config.actions as FeatureActions) ?? DEFAULT_ACTIONS);
      setTodayCards(home.today.cards ?? []);
      setTodayBanner(home.today.banner);
      setActiveChallenges(home.activeChallenges ?? []);
      setStreak(home.streak);
      maybeShowStreakToast(home.streak, prevTodayCompleted);
      setPrevTodayCompleted(home.streak.todayCompleted);
      setTodayError(null);
    } catch {
      await refresh();
      await refreshTodayCards();
    }
  }

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

  async function handleLogout() {
    try {
      await api.logout();
    } catch {}
    clearUserId();
    router.replace("/login");
  }

  useEffect(() => {
    setResetsIn(getResetsInUtc());
    const interval = setInterval(() => setResetsIn(getResetsInUtc()), 60_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (homeContext !== "miniapp") return;
    if (!fundingEnabled || !walletReady) return;
    if (fundingUiMode !== "open_in_wallet") return;
    const onFocus = async () => {
      await addMoneyRefresh();
      await refreshEverything();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [homeContext, fundingEnabled, walletReady, fundingUiMode, userId]);

  return (
    <main className="mx-auto max-w-xl p-6 space-y-6">
      {toastMsg && (
        <div
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 rounded-lg bg-black text-white px-4 py-2 text-sm font-medium shadow-lg animate-in fade-in duration-200"
          role="status"
        >
          {toastMsg}
        </div>
      )}
      <header className="space-y-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-3xl font-bold">My Stash Jar</h1>
          {streak && (
            <div className="text-right text-sm space-y-0.5">
              <span className="font-medium">🔥 {streak.currentStreakDays}-day streak</span>
              {streak.bestStreakDays > 0 && (
                <p className="text-xs opacity-70">Best: {streak.bestStreakDays}</p>
              )}
              {streak.streakStatus === "needs_recovery" && streak.recoveryTarget != null && (
                <p className="text-xs font-medium text-amber-700 bg-amber-100 rounded px-1.5 py-0.5 inline-block">
                  Recover streak ({streak.recoveryTarget} saves)
                </p>
              )}
              {streak.streakShieldAvailable && streak.streakStatus === "ok" && (
                <p className="text-xs opacity-70">🛡️ Shield ready</p>
              )}
              {!streak.todayCompleted && streak.streakStatus !== "needs_recovery" && (
                <p className="text-xs opacity-70 mt-0.5">Save today to keep it alive</p>
              )}
            </div>
          )}
        </div>
        <p className="text-sm opacity-70 flex items-center gap-2">
          Tier: {tier}
          {actions.canDiceChooseSides && (
            <span className="text-xs font-medium bg-violet-100 text-violet-800 rounded px-1.5 py-0.5">POWER</span>
          )}
        </p>
      </header>

      {userId && actions.canPushReminders && (
        <PushReminderToggle />
      )}

      <section className="rounded-xl border p-5 space-y-3">
        <div className="text-sm opacity-70">Stash Balance</div>
        <div className="text-4xl font-bold">{fmt(balanceCents)}</div>
        {status && <div className="text-sm opacity-70">{status}</div>}
      </section>

      {userId && (
        <FundingCta
          walletAddress={walletAddress}
          enabled={fundingEnabled}
          context={homeContext}
          uiMode={fundingUiMode}
          deeplink={fundingDeeplink}
          helperText={fundingHelperText}
          lastRefreshAt={lastFundingRefreshAt}
          busy={fundingBusy}
          onSetUpWallet={ensureWalletThenRefresh}
          onAddMoney={addMoneyRefresh}
          onRefreshHome={refreshEverything}
          walletReady={walletReady}
          setToast={setToastMsg}
          maxCreditsPerDayCents={maxCreditsPerDayCents}
        />
      )}

      {todayError && (
        <section className="rounded-xl border p-5 text-sm text-red-600">
          {todayError}
        </section>
      )}

      {todayBanner && userId && (
        <ApplyMissedSavesBanner
          userId={userId}
          banner={todayBanner}
          onDone={refreshEverything}
        />
      )}

      {doneForToday && (
        <section className="rounded-xl border border-green-200 bg-green-50/50 p-5 space-y-4">
          <h2 className="text-xl font-semibold">You&apos;re done for today ✅</h2>
          <p className="text-sm opacity-80">Your stash is on track. Come back tomorrow.</p>
          {resetsIn && (
            <p className="text-xs opacity-70">Resets in {resetsIn}</p>
          )}
          {streak && (streak.currentStreakDays > 0 || streak.bestStreakDays > 0) && (
            <p className="text-sm">
              🔥 {streak.currentStreakDays}-day streak
              {streak.bestStreakDays > 0 && ` · Best: ${streak.bestStreakDays}`}
            </p>
          )}
          <div className="flex flex-wrap gap-3 pt-1">
            <a className="underline text-sm font-medium" href="/history">
              View activity
            </a>
            <a className="underline text-sm font-medium" href="/challenges">
              Challenges
            </a>
          </div>
        </section>
      )}

      {userId &&
        !doneForToday &&
        sortedCards.map((card, index) => {
          const eventId = (card as any).eventId;
          const userChallengeId = (card as any).userChallengeId;
          const key = `${card.type}_${eventId ?? userChallengeId ?? card.scheduledFor ?? index}`;
          const id = eventId ? `card_${eventId}` : undefined;
          const highlight =
            focusEventId && eventId && focusEventId === eventId
              ? "ring-2 ring-yellow-400"
              : "";
          return (
            <div key={key} id={id} className={highlight}>
              {actions.canDiceChooseSides && (
                <span className="text-xs font-medium text-violet-600 mb-1 inline-block">POWER</span>
              )}
              <TodayCardRenderer userId={userId} card={card} actions={actions} onDone={refreshEverything} />
            </div>
          );
        })}

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

      {activeChallenges.length > 0 && (
        <a
          href="/challenges"
          className="block rounded-xl border p-4 text-sm opacity-90 hover:opacity-100 transition-opacity"
        >
          <span className="font-medium">Active challenges: </span>
          {activeChallenges
            .map((c) => (c.progress ? `${c.name} (${c.progress})` : c.name))
            .join(", ")}
          <span className="ml-1">→</span>
        </a>
      )}

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
        {userId && (
          <>
            User: {userId} •{" "}
            <button onClick={handleLogout} className="underline">
              Sign out
            </button>
          </>
        )}
      </footer>
    </main>
  );
}
