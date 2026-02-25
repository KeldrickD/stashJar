"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { api, getRetryInfo, type FeatureActions, TodayCard, TodayBanner } from "@/lib/api";
import { setUserId as saveUserId, clearUserId } from "@/lib/session";
import { ApplyMissedSavesBanner } from "@/components/ApplyMissedSavesBanner";
import { DailyLimitCountdown } from "@/components/DailyLimitCountdown";
import { FundingCta } from "@/components/FundingCta";
import { PushReminderToggle } from "@/components/PushReminderToggle";
import { TodayCardRenderer } from "@/components/TodayCardRenderer";
import { BaseChip } from "@/components/Badges";
import { StashStatusLine } from "@/components/StashStatusLine";
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

function cardIcon(type: TodayCard["type"]): string {
  switch (type) {
    case "temperature_daily":
      return "🌡️";
    case "dice_daily":
      return "🎲";
    case "weather_wednesday":
      return "🌦️";
    case "envelopes_100":
      return "✉️";
    default:
      return "✨";
  }
}

const DEFAULT_ACTIONS: FeatureActions = {
  canFund: false,
  preferredFundingRail: "MANUAL_REFRESH_ONLY",
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

function HomeContent() {
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
  const [focusUserChallengeId, setFocusUserChallengeId] = useState<string | null>(null);
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
  const [fundingDeeplinkKind, setFundingDeeplinkKind] = useState<"env" | "generated" | "none" | undefined>(undefined);
  const [fundingHelperText, setFundingHelperText] = useState<string | undefined>(undefined);

  const lastFocusRefreshAt = useRef<number>(0);
  const FOCUS_REFRESH_DEBOUNCE_MS = 8_000;

  const [depositDollars, setDepositDollars] = useState("10");
  const [withdrawDollars, setWithdrawDollars] = useState("5");
  const [withdrawDailyLimitNextAllowedAt, setWithdrawDailyLimitNextAllowedAt] = useState<string | null>(null);
  const [hasEverSavedChallenge, setHasEverSavedChallenge] = useState<boolean>(false);
  const [weeklySavedCents, setWeeklySavedCents] = useState<number>(0);
  const [showDepositModal, setShowDepositModal] = useState<boolean>(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState<boolean>(false);

  const advancedVisible = useMemo(
    () => flags.show_view_onchain || flags.show_powered_by_base_badge,
    [flags],
  );

  const sortedCards = useMemo(() => sortTodayCards(todayCards), [todayCards]);
  const doneForToday = Boolean(
    streak?.todayCompleted && sortedCards.length === 0 && !todayBanner && !todayError,
  );
  const primaryCard = sortedCards[0];
  const secondaryCards = sortedCards.slice(1);

  const refreshWeeklySaved = useCallback(async (uid?: string) => {
    const id = uid ?? userId;
    if (!id) return;
    try {
      const tx = await api.getTxHistory(id);
      const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const weekly = (tx.transactions ?? []).reduce((sum, item) => {
        const t = new Date(item.occurredAt).getTime();
        if (Number.isNaN(t) || t < oneWeekAgo) return sum;
        if (item.amountCents <= 0) return sum;
        return sum + item.amountCents;
      }, 0);
      setWeeklySavedCents(weekly);
    } catch {
      setWeeklySavedCents(0);
    }
  }, [userId]);

  async function ensureWalletThenRefresh() {
    if (!userId) return;
    setFundingBusy(true);
    try {
      await api.walletProvision(userId);
      await refreshEverything();
    } catch (e: unknown) {
      setToastMsg(e instanceof Error ? e.message : "Wallet setup failed");
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
      const flow = actions.preferredFundingRail === "OPEN_IN_WALLET" ? "open_in_wallet" : "fundcard";
      const res = await api.fundingRefresh(userId, {
        clientContext: { source: homeContext, flow, sessionHint: "fund_v1" },
      });
      const status = res?.result?.status ?? null;
      const created = res?.result?.status === "SETTLED" ? res.result.createdPaymentIntents : 0;
      const deltaCents = res?.accounting?.deltaCents ?? 0;
      if (status === "SETTLED") {
        void api.trackEvent({
          event: "funding_settled",
          metadata: { deltaCents, context: homeContext },
        }).catch(() => undefined);
      }
      return { status: status ?? undefined, createdPaymentIntents: created, deltaCents };
    } catch (e: unknown) {
      try {
        const msg = e instanceof Error ? e.message : "";
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
      setToastMsg(e instanceof Error ? e.message : "Refresh failed");
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
    } catch (err: unknown) {
      setTodayError(err instanceof Error ? err.message : "Failed to load today cards");
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
          setBalanceCents(home.stash?.totalDisplayCents ?? 0);
          setFundingEnabled(!!home.funding?.enabled);
          setWalletReady(!!home.wallet?.ready);
          setWalletAddress(home.wallet?.address ?? null);
          setLastFundingRefreshAt(home.funding?.lastRefreshAt ?? null);
          setMaxCreditsPerDayCents(home.funding?.limits?.maxCreditsPerDayCents ?? undefined);
          setFundingUiMode(
            (home.funding?.ui?.mode as "fundcard" | "open_in_wallet" | undefined) ?? "fundcard",
          );
          setFundingDeeplink(home.funding?.ui?.deeplink ?? undefined);
          setFundingDeeplinkKind(home.funding?.ui?.deeplinkKind ?? undefined);
          setFundingHelperText(home.funding?.ui?.helperText ?? undefined);
          setHasEverSavedChallenge(home.analytics?.hasEverSavedChallenge === true);
          setTier(home.config.tier);
          setFlags(home.config.flags as Record<string, boolean>);
          setActions(home.config.actions ?? DEFAULT_ACTIONS);
          setTodayCards(home.today.cards ?? []);
          setTodayBanner(home.today.banner);
          setActiveChallenges(home.activeChallenges ?? []);
          setStreak(home.streak);
          setPrevTodayCompleted(home.streak.todayCompleted);
          setTodayError(null);
          void refreshWeeklySaved(uid);
          const stored = localStorage.getItem("focusEventId");
          if (stored) setFocusEventId(stored);
          if (typeof sessionStorage !== "undefined" && !sessionStorage.getItem("ev_visit_home")) {
            sessionStorage.setItem("ev_visit_home", "1");
            void api.trackEvent({
              event: "visit_home",
              metadata: { context: homeContext },
            }).catch(() => undefined);
          }
        } catch (err: unknown) {
          if (alive) setTodayError(err instanceof Error ? err.message : "Failed to load home");
          if (alive) setTodayCards([]);
          if (alive) setTodayBanner(undefined);
          if (alive) setActiveChallenges([]);
          if (alive) setStreak(null);
        }

        setStatus("");
      } catch (e: unknown) {
        if (!alive) return;
        setStatus(e instanceof Error ? e.message : "Failed to load");
      }
    })();
    return () => {
      alive = false;
    };
  }, [router, pathname, homeContext, refreshWeeklySaved]);

  useEffect(() => {
    const focus = searchParams?.get("focus");
    const ucid = searchParams?.get("userChallengeId");
    if (focus === "challenge" && ucid) {
      setFocusUserChallengeId(ucid);
    } else {
      setFocusUserChallengeId(null);
    }
  }, [searchParams]);

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
    if (!focusUserChallengeId) return;
    const cardEl = document.querySelector(`[data-user-challenge-id="${focusUserChallengeId}"]`) as HTMLElement | null;
    const activeEl = document.getElementById(`active_uc_${focusUserChallengeId}`);
    const target = cardEl ?? activeEl;
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    const timeout = setTimeout(() => {
      setFocusUserChallengeId(null);
    }, 2000);
    return () => clearTimeout(timeout);
  }, [focusUserChallengeId, todayCards, activeChallenges]);

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
      setBalanceCents(home.stash?.totalDisplayCents ?? 0);
      setFundingEnabled(!!home.funding?.enabled);
      setWalletReady(!!home.wallet?.ready);
      setWalletAddress(home.wallet?.address ?? null);
      setLastFundingRefreshAt(home.funding?.lastRefreshAt ?? null);
      setMaxCreditsPerDayCents(home.funding?.limits?.maxCreditsPerDayCents ?? undefined);
      setFundingUiMode(
        (home.funding?.ui?.mode as "fundcard" | "open_in_wallet" | undefined) ?? "fundcard",
      );
      setFundingDeeplink(home.funding?.ui?.deeplink ?? undefined);
      setFundingDeeplinkKind(home.funding?.ui?.deeplinkKind ?? undefined);
      setFundingHelperText(home.funding?.ui?.helperText ?? undefined);
      const nextHasEverSavedChallenge = home.analytics?.hasEverSavedChallenge === true;
      if (
        !hasEverSavedChallenge &&
        nextHasEverSavedChallenge &&
        typeof sessionStorage !== "undefined" &&
        !sessionStorage.getItem("ev_first_save_completed")
      ) {
        sessionStorage.setItem("ev_first_save_completed", "1");
        void api.trackEvent({
          event: "first_save_completed",
          metadata: { context: homeContext },
        }).catch(() => undefined);
      }
      setHasEverSavedChallenge(nextHasEverSavedChallenge);
      setTier(home.config.tier);
      setFlags(home.config.flags as Record<string, boolean>);
      setActions(home.config.actions ?? DEFAULT_ACTIONS);
      setTodayCards(home.today.cards ?? []);
      setTodayBanner(home.today.banner);
      setActiveChallenges(home.activeChallenges ?? []);
      setStreak(home.streak);
      maybeShowStreakToast(home.streak, prevTodayCompleted);
      setPrevTodayCompleted(home.streak.todayCompleted);
      setTodayError(null);
      void refreshWeeklySaved(uid);
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
    await refreshEverything();
    setShowDepositModal(false);
    setStatus("");
  }

  async function doWithdraw() {
    if (!userId) return;
    setWithdrawDailyLimitNextAllowedAt(null);
    setStatus("Requesting withdrawal…");
    try {
      const amountCents = Math.round(Number(withdrawDollars) * 100);
      const pi = await api.requestWithdraw(userId, amountCents);
      setStatus("Marking paid…");
      await api.markWithdrawPaid(pi.id);
      await refreshEverything();
      setShowWithdrawModal(false);
      setStatus("");
    } catch (e) {
      const retry = getRetryInfo(e);
      if (retry?.kind === "daily_limit") {
        setWithdrawDailyLimitNextAllowedAt(retry.nextAllowedAt ?? null);
        setToastMsg("Withdraw daily limit reached.");
      } else {
        setToastMsg(e instanceof Error ? e.message : "Withdraw failed");
      }
      setStatus("");
    }
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
    if (actions.preferredFundingRail !== "OPEN_IN_WALLET") return;
    if (!fundingEnabled || !walletReady) return;
    const tryReturnRefresh = async () => {
      const now = Date.now();
      if (now - lastFocusRefreshAt.current < FOCUS_REFRESH_DEBOUNCE_MS) return;
      lastFocusRefreshAt.current = now;
      const result = await addMoneyRefresh();
      if (result && "status" in result && result.status === "SETTLED") {
        await refreshEverything();
      }
    };
    const onFocus = () => {
      void tryReturnRefresh();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void tryReturnRefresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [actions.preferredFundingRail, fundingEnabled, walletReady, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="mx-auto max-w-xl px-4 py-6 space-y-6">
      {toastMsg && (
        <div
          className="sj-toast sj-pop"
          role="status"
        >
          {toastMsg}
        </div>
      )}

      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs tracking-[0.16em] uppercase font-semibold text-emerald-700/80">StashJar</p>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Your Stash</h1>
        </div>
        {streak && (
          <div className="text-right">
            <div className="sj-badge sj-badge-gold">🔥 {streak.currentStreakDays}-day streak</div>
            {streak.bestStreakDays > 0 && (
              <p className="text-xs sj-text-faint mt-1">Best: {streak.bestStreakDays}</p>
            )}
          </div>
        )}
      </header>

      <section className="sj-card p-6 space-y-4 sj-appear">
        <div className="flex items-center justify-between">
          <p className="text-xs sj-text-faint tracking-wide">Vault Balance</p>
          <BaseChip />
        </div>
        <p className="text-5xl font-semibold tracking-tight sj-count">{fmt(balanceCents)}</p>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="sj-card-solid p-3">
            <p className="text-xs sj-text-faint">Total saved</p>
            <p className="font-semibold mt-1">{fmt(balanceCents)}</p>
          </div>
          <div className="sj-card-solid p-3">
            <p className="text-xs sj-text-faint">This week</p>
            <p className="font-semibold mt-1">{fmt(weeklySavedCents)}</p>
          </div>
          <div className="sj-card-solid p-3">
            <p className="text-xs sj-text-faint">Streak</p>
            <p className="font-semibold mt-1">🔥 {streak?.currentStreakDays ?? 0}d</p>
          </div>
        </div>
        {status && (
          <StashStatusLine
            tone="muted"
            compact
            text={status}
          />
        )}
      </section>

      {userId && actions.canPushReminders && (
        <div className="sj-card p-4">
          <PushReminderToggle />
        </div>
      )}

      {todayError && (
        <section className="sj-card p-5 text-sm text-red-600">
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
        <section className="sj-card-soft p-5 space-y-4">
          <h2 className="text-xl font-semibold">You&apos;re done for today ✅</h2>
          <p className="text-sm sj-text-muted">Your stash is on track. Come back tomorrow.</p>
          {resetsIn && (
            <p className="text-xs sj-text-faint">Resets in {resetsIn}</p>
          )}
          <div className="flex flex-wrap gap-3 pt-1">
            <Link className="sj-link text-sm" href="/history">
              View activity
            </Link>
            <Link className="sj-link text-sm" href="/challenges">
              Challenges
            </Link>
          </div>
        </section>
      )}

      {userId && !doneForToday && primaryCard && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold sj-text-muted">Today&apos;s Save</p>
            <span className="text-xs sj-text-faint">~5 sec</span>
          </div>
          <div className="sj-card-solid p-1 ring-2 ring-emerald-200/60 sj-lift sj-appear">
            <div className="px-4 pt-4 flex items-center gap-2 text-sm">
              <span className="text-xl">{cardIcon(primaryCard.type)}</span>
              <span className="font-semibold sj-text-muted">Keep your streak alive. You are building momentum.</span>
            </div>
            <TodayCardRenderer userId={userId} card={primaryCard} actions={actions} onDone={refreshEverything} />
          </div>
        </section>
      )}

      {userId &&
        !doneForToday &&
        secondaryCards.map((card, index) => {
          const eventId = "eventId" in card && typeof card.eventId === "string" ? card.eventId : undefined;
          const userChallengeId =
            "userChallengeId" in card && typeof card.userChallengeId === "string"
              ? card.userChallengeId
              : undefined;
          const scheduledFor =
            "scheduledFor" in card && typeof card.scheduledFor === "string"
              ? card.scheduledFor
              : undefined;
          const key = `${card.type}_${eventId ?? userChallengeId ?? scheduledFor ?? index}`;
          const id = eventId ? `card_${eventId}` : undefined;
          const highlightByEvent =
            focusEventId && eventId && focusEventId === eventId
              ? "ring-2 ring-yellow-300 rounded-2xl"
              : "";
          const highlightByChallenge =
            focusUserChallengeId && userChallengeId && focusUserChallengeId === userChallengeId
              ? "ring-2 ring-yellow-300 rounded-2xl"
              : "";
          const highlight = `${highlightByEvent} ${highlightByChallenge}`.trim();
          return (
            <div
              key={key}
              id={id}
              className={`sj-card-solid p-1 sj-lift ${highlight}`.trim()}
              data-user-challenge-id={userChallengeId ?? undefined}
            >
              <div className="px-4 pt-4 pb-1 flex items-center gap-2 text-sm sj-text-muted">
                <span className="text-xl">{cardIcon(card.type)}</span>
                <span className="font-medium">Daily action</span>
              </div>
              <TodayCardRenderer userId={userId} card={card} actions={actions} onDone={refreshEverything} />
            </div>
          );
        })}

      <section className="sj-card-solid p-5 space-y-4 sj-appear">
        <div>
          <h2 className="text-xl font-semibold">Manage Funds</h2>
          <p className="text-sm sj-text-muted mt-1">Move money in and out of your vault.</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setShowDepositModal(true)}
            className="sj-btn sj-btn-primary py-3 text-sm sj-lift"
          >
            Add Money
          </button>
          <button
            type="button"
            onClick={() => setShowWithdrawModal(true)}
            className="sj-btn sj-btn-secondary py-3 text-sm sj-lift"
          >
            Withdraw
          </button>
        </div>
      </section>

      {userId && (
        <div className="sj-card p-5">
          <FundingCta
            walletAddress={walletAddress}
            enabled={fundingEnabled}
            preferredFundingRail={actions.preferredFundingRail}
            context={homeContext}
            uiMode={fundingUiMode}
            deeplink={fundingDeeplink}
            deeplinkKind={fundingDeeplinkKind}
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
        </div>
      )}

      {activeChallenges.length > 0 && (
        <section className="sj-card p-5 text-sm space-y-3">
          <div className="font-medium">Active challenges</div>
          <div className="flex flex-wrap gap-2">
            {activeChallenges.map((c) => (
              <span
                key={c.userChallengeId}
                id={`active_uc_${c.userChallengeId}`}
                className="sj-badge sj-badge-brand"
              >
                {c.progress ? `${c.name} (${c.progress})` : c.name}
              </span>
            ))}
          </div>
          <Link href="/challenges" className="sj-link inline-block">
            Manage challenges →
          </Link>
        </section>
      )}

      <section className="sj-card p-5 space-y-3">
        <h2 className="text-xl font-semibold">Explore</h2>
        <div className="grid grid-cols-1 gap-2">
          <Link className="sj-link" href="/challenges">
            Go to challenges
          </Link>
          <Link className="sj-link" href="/history">
            View history
          </Link>
        </div>
      </section>

      {advancedVisible && (
        <section className="sj-card p-5 space-y-2">
          <h2 className="text-base font-semibold">Advanced</h2>
          <div className="text-xs sj-text-faint">Profile tier: {tier}</div>
          {flags.show_powered_by_base_badge && (
            <div className="text-sm sj-text-muted">Powered by Base</div>
          )}
          {flags.show_view_onchain && (
            <div className="text-sm sj-text-faint">Onchain view will appear here soon.</div>
          )}
        </section>
      )}

      {showDepositModal && (
        <div className="sj-modal-backdrop">
          <div className="w-full max-w-md sj-card p-5 space-y-4">
            <h3 className="text-lg font-semibold">Add money</h3>
            <input
              value={depositDollars}
              onChange={(e) => setDepositDollars(e.target.value)}
              className="sj-input"
              inputMode="decimal"
              placeholder="Amount in USD"
            />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setShowDepositModal(false)} className="sj-btn sj-btn-secondary py-2.5">
                Cancel
              </button>
              <button type="button" onClick={doDeposit} className="sj-btn sj-btn-primary py-2.5">
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {showWithdrawModal && (
        <div className="sj-modal-backdrop">
          <div className="w-full max-w-md sj-card p-5 space-y-4">
            <h3 className="text-lg font-semibold">Withdraw</h3>
            <input
              value={withdrawDollars}
              onChange={(e) => setWithdrawDollars(e.target.value)}
              className="sj-input"
              inputMode="decimal"
              placeholder="Amount in USD"
            />
            {withdrawDailyLimitNextAllowedAt && (
              <DailyLimitCountdown nextAllowedAt={withdrawDailyLimitNextAllowedAt} label="Withdraw daily limit reached" />
            )}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setShowWithdrawModal(false)} className="sj-btn sj-btn-secondary py-2.5">
                Cancel
              </button>
              <button type="button" onClick={doWithdraw} className="sj-btn sj-btn-primary py-2.5">
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="text-xs sj-text-faint pb-8">
        {userId && (
          <>
            User: {userId} •{" "}
            <button onClick={handleLogout} className="sj-link">
              Sign out
            </button>
          </>
        )}
      </footer>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-xl p-6">Loading…</main>}>
      <HomeContent />
    </Suspense>
  );
}
