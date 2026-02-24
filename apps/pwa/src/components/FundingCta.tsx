"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, getRetryInfo } from "@/lib/api";
import { DailyLimitCountdown } from "./DailyLimitCountdown";
import { FundingModal } from "./FundingModal";

const POLL_INTERVAL_MS = 5_000;
const POLL_MAX_DURATION_MS = 60_000;

function formatLastChecked(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const at = new Date(iso).getTime();
  const sec = Math.floor((Date.now() - at) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  return `${min}m ago`;
}

import type { FundingRail } from "@/lib/api";

type Props = {
  walletAddress: string | null;
  enabled: boolean;
  /** Server-derived; drives primary behavior (no client inference). */
  preferredFundingRail: FundingRail;
  context?: "pwa" | "miniapp";
  /** From home.funding.ui (source of truth for display). */
  uiMode?: "fundcard" | "open_in_wallet";
  deeplink?: string;
  deeplinkKind?: "env" | "generated" | "none";
  helperText?: string;
  lastRefreshAt: string | null | undefined;
  busy: boolean;
  onSetUpWallet: () => void;
  onAddMoney: () => Promise<
    { status?: string; createdPaymentIntents?: number; deltaCents?: number }
    | { error: "daily_limit"; retryAfterSeconds: number; nextAllowedAt: string }
    | void
  >;
  onRefreshHome: () => void;
  walletReady: boolean;
  setToast: (msg: string) => void;
  /** From home.funding.limits.maxCreditsPerDayCents (POWER tier) */
  maxCreditsPerDayCents?: number;
};

export function FundingCta({
  enabled,
  preferredFundingRail,
  context = "pwa",
  uiMode = "fundcard",
  deeplink,
  helperText,
  lastRefreshAt,
  busy,
  onSetUpWallet,
  onAddMoney,
  onRefreshHome,
  walletReady,
  setToast,
  maxCreditsPerDayCents,
}: Props) {
  const [polling, setPolling] = useState(false);
  const [showFundingModal, setShowFundingModal] = useState(false);
  const [fundingSessionToken, setFundingSessionToken] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [dailyLimitNextAllowedAt, setDailyLimitNextAllowedAt] = useState<string | null>(null);
  const pollUntil = useRef<number>(0);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!polling || pollUntil.current <= Date.now()) {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
      return;
    }
    const tick = async () => {
      if (Date.now() >= pollUntil.current) {
        setPolling(false);
        if (pollTimer.current) clearInterval(pollTimer.current);
        pollTimer.current = null;
        setToast("Nothing new yet — try again in a moment.");
        return;
      }
      const res = await onAddMoney();
      const result = res as
        | { status?: string; createdPaymentIntents?: number; deltaCents?: number }
        | { error: "daily_limit"; retryAfterSeconds: number; nextAllowedAt: string }
        | undefined;
      if (result && "error" in result && result.error === "daily_limit") {
        setPolling(false);
        if (pollTimer.current) clearInterval(pollTimer.current);
        pollTimer.current = null;
        setToast("Daily limit reached — resets at midnight UTC");
        setDailyLimitNextAllowedAt(result.nextAllowedAt ?? null);
        return;
      }
      if (result && !("error" in result) && result.status === "SETTLED" && (result.createdPaymentIntents ?? 0) > 0) {
        setPolling(false);
        if (pollTimer.current) clearInterval(pollTimer.current);
        pollTimer.current = null;
        onRefreshHome();
        const cents = result.deltaCents ?? 0;
        setToast(cents > 0 ? `Added $${(cents / 100).toFixed(2)} ✅` : "Added ✅");
      }
    };
    pollTimer.current = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [polling, onAddMoney, onRefreshHome, setToast]);

  const handleAddMoney = async () => {
    setDailyLimitNextAllowedAt(null);
    try {
      const res = await onAddMoney();
      const result = res as
        | { status?: string; createdPaymentIntents?: number; deltaCents?: number }
        | { error: "daily_limit"; retryAfterSeconds: number; nextAllowedAt: string }
        | undefined;
      if (result && "error" in result && result.error === "daily_limit") {
        setToast("Daily limit reached — resets at midnight UTC");
        setDailyLimitNextAllowedAt(result.nextAllowedAt ?? null);
        return;
      }
      onRefreshHome();
      if (result && !("error" in result) && result.status === "SETTLED" && (result.createdPaymentIntents ?? 0) > 0) {
        const cents = result.deltaCents ?? 0;
        setToast(cents > 0 ? `Added $${(cents / 100).toFixed(2)} ✅` : "Added ✅");
      } else if (result && !("error" in result) && result.status === "NO_CHANGE") {
        setToast("Nothing new yet — try again in a moment.");
        setPolling(true);
        pollUntil.current = Date.now() + POLL_MAX_DURATION_MS;
      }
    } catch (e: unknown) {
      const retry = getRetryInfo(e);
      if (retry?.kind === "daily_limit") {
        setToast("Daily limit reached — resets at midnight UTC");
        setDailyLimitNextAllowedAt(retry.nextAllowedAt ?? null);
      } else {
        setToast(e instanceof Error ? e.message : "Refresh failed");
      }
    }
  };

  const handleAddMoneyClick = async () => {
    if (preferredFundingRail === "OPEN_IN_WALLET") {
      if (deeplink) {
        window.location.href = deeplink;
        return;
      }
      setToast("Open your wallet app to add funds, then return here and tap Refresh.");
      await handleAddMoney();
      return;
    }

    if (preferredFundingRail === "FUND_CARD") {
      setSessionLoading(true);
    setDailyLimitNextAllowedAt(null);
    try {
      const session = await api.getFundingSession({ context });
      if (session?.sessionToken) {
        setFundingSessionToken(session.sessionToken);
        setShowFundingModal(true);
        setSessionLoading(false);
        return;
      }
    } catch (e: unknown) {
      const retry = getRetryInfo(e);
      if (retry?.kind === "daily_limit") {
        setToast("Daily add limit reached — resets at midnight UTC");
        setDailyLimitNextAllowedAt(retry.nextAllowedAt ?? null);
        setSessionLoading(false);
        return;
      }
      // 501 or 503 or 409: fall back to manual refresh
    }
    setSessionLoading(false);
    await handleAddMoney();
    }
  };

  const handleCloseFundingModal = () => {
    setShowFundingModal(false);
    setFundingSessionToken(null);
  };

  const lastChecked = formatLastChecked(lastRefreshAt);

  if (!walletReady) {
    return (
      <section className="rounded-xl border p-5 space-y-3">
        <h3 className="font-semibold">Set up your Stash</h3>
        <p className="text-sm opacity-70">Takes a moment.</p>
        <button
          type="button"
          disabled={busy}
          onClick={onSetUpWallet}
          className="rounded bg-black text-white px-4 py-2 font-medium"
        >
          {busy ? "Setting up…" : "Set up wallet"}
        </button>
      </section>
    );
  }

  if (preferredFundingRail === "MANUAL_REFRESH_ONLY" || !enabled) {
    return (
      <section className="rounded-xl border p-5 space-y-3">
        <p className="text-sm opacity-70">
          {preferredFundingRail === "MANUAL_REFRESH_ONLY" ? "Funding not available right now." : "Funding not available right now."}
        </p>
        <Link href="/history" className="rounded border border-black px-4 py-2 font-medium inline-block">
          Withdraw
        </Link>
      </section>
    );
  }

  return (
    <section className="rounded-xl border p-5 space-y-3">
      <FundingModal
        open={showFundingModal}
        sessionToken={fundingSessionToken}
        onClose={handleCloseFundingModal}
        onAfterFunding={handleAddMoney}
      />
      <div className="flex flex-wrap gap-2 items-center">
        <button
          type="button"
          disabled={busy || polling || sessionLoading}
          onClick={handleAddMoneyClick}
          className="rounded bg-black text-white px-4 py-2 font-medium"
        >
          {sessionLoading ? "Opening…" : busy ? "Refreshing…" : polling ? "Checking…" : "Add money"}
        </button>
        <Link href="/history" className="rounded border border-black px-4 py-2 font-medium inline-block">
          Withdraw
        </Link>
      </div>
      {polling && (
        <p className="text-sm text-amber-700">Waiting for funds… We’ll check again in a few seconds.</p>
      )}
      {!polling && lastChecked && (
        <p className="text-xs opacity-70">Last checked {lastChecked}</p>
      )}
      {dailyLimitNextAllowedAt && (
        <DailyLimitCountdown nextAllowedAt={dailyLimitNextAllowedAt} label="Daily limit reached" />
      )}
      {maxCreditsPerDayCents != null && maxCreditsPerDayCents > 0 && !dailyLimitNextAllowedAt && (
        <p className="text-xs opacity-70">Daily add limit: ${(maxCreditsPerDayCents / 100).toFixed(0)}</p>
      )}
      <p className="text-xs opacity-70">
        {helperText
          ?? (uiMode === "open_in_wallet" && !deeplink
            ? "Open your wallet app to add funds, then return here and refresh."
            : "Add money via Coinbase → tap ")}
        {!helperText && !(uiMode === "open_in_wallet" && !deeplink) && <strong>Refresh</strong>}
        {!helperText && !(uiMode === "open_in_wallet" && !deeplink) && " if your balance doesn’t update in ~30s."}
      </p>
    </section>
  );
}
