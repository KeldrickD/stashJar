/**
 * POWER tier funding rules: session limits, refresh (credit) limits, withdraw daily limits.
 * Tier defaults + user flag overrides (user.flags.maxDepositCents, etc.).
 */
import type { UserTier } from "../generated/client";

export type Tier = "NORMIE" | "CURIOUS" | "POWER" | "DEV";

/** Limits exposed in buildWalletAndFunding and used by POST /funding/session (display) */
export type FundingSessionLimits = {
  minDepositCents: number;
  maxDepositCents: number;
  sessionsPerMinute: number;
  sessionsPerDay: number;
};

/** Limits enforced in POST /users/:id/funding/refresh */
export type FundingRefreshLimits = {
  minCreditDeltaCents: number;
  maxCreditPerCallCents: number;
  maxCreditsPerDayCents: number;
};

/** Withdraw-to-wallet daily cap (POWER/DEV only; NORMIE/CURIOUS disabled via enableOnchainWithdrawToWallet) */
export type WithdrawLimits = {
  dailyLimitCents: number;
};

const DEFAULTS: Record<Tier, FundingSessionLimits & FundingRefreshLimits & WithdrawLimits> = {
  NORMIE: {
    minDepositCents: 100,
    maxDepositCents: 10_000, // $100
    sessionsPerMinute: 3,
    sessionsPerDay: 20,
    minCreditDeltaCents: 100,
    maxCreditPerCallCents: 10_000,
    maxCreditsPerDayCents: 25_000, // $250/day
    dailyLimitCents: 0, // withdraw disabled
  },
  CURIOUS: {
    minDepositCents: 100,
    maxDepositCents: 10_000,
    sessionsPerMinute: 3,
    sessionsPerDay: 20,
    minCreditDeltaCents: 100,
    maxCreditPerCallCents: 10_000,
    maxCreditsPerDayCents: 25_000,
    dailyLimitCents: 0,
  },
  POWER: {
    minDepositCents: 100,
    maxDepositCents: 50_000, // $500
    sessionsPerMinute: 3,
    sessionsPerDay: 50,
    minCreditDeltaCents: 100,
    maxCreditPerCallCents: 50_000,
    maxCreditsPerDayCents: 200_000, // $2,000/day
    dailyLimitCents: 100_000, // $1,000/day withdraw
  },
  DEV: {
    minDepositCents: 100,
    maxDepositCents: 200_000, // $2,000
    sessionsPerMinute: 6,
    sessionsPerDay: 200,
    minCreditDeltaCents: 100,
    maxCreditPerCallCents: 200_000,
    maxCreditsPerDayCents: 1_000_000, // $10,000/day
    dailyLimitCents: 500_000, // $5,000/day withdraw
  },
};

function tierKey(tier: UserTier | string): Tier {
  const t = String(tier).toUpperCase();
  if (t === "NORMIE" || t === "CURIOUS" || t === "POWER" || t === "DEV") return t;
  return "NORMIE";
}

/** Session limits for FundCard / POST /funding/session (display + rate limit) */
export function getFundingSessionLimits(
  tier: UserTier | string,
  userFlags: Record<string, unknown> | null | undefined,
): FundingSessionLimits {
  const key = tierKey(tier);
  const d = DEFAULTS[key];
  const flags = userFlags ?? {};
  return {
    minDepositCents: typeof flags.minDepositCents === "number" ? flags.minDepositCents : d.minDepositCents,
    maxDepositCents: typeof flags.maxDepositCents === "number" ? flags.maxDepositCents : d.maxDepositCents,
    sessionsPerMinute: d.sessionsPerMinute,
    sessionsPerDay: typeof flags.fundingSessionsPerDay === "number" ? flags.fundingSessionsPerDay : d.sessionsPerDay,
  };
}

/** Refresh (credit) limits for POST /users/:id/funding/refresh */
export function getFundingRefreshLimits(
  tier: UserTier | string,
  userFlags: Record<string, unknown> | null | undefined,
): FundingRefreshLimits {
  const key = tierKey(tier);
  const d = DEFAULTS[key];
  return {
    minCreditDeltaCents: d.minCreditDeltaCents,
    maxCreditPerCallCents: d.maxCreditPerCallCents,
    maxCreditsPerDayCents: d.maxCreditsPerDayCents,
  };
}

/** Combined limits for buildWalletAndFunding (deposit min/max + daily credit cap for UI) */
export function getFundingLimitsForUi(
  tier: UserTier | string,
  userFlags: Record<string, unknown> | null | undefined,
): FundingSessionLimits & { maxCreditPerCallCents: number; maxCreditsPerDayCents: number } {
  const session = getFundingSessionLimits(tier, userFlags);
  const refresh = getFundingRefreshLimits(tier, userFlags);
  return {
    ...session,
    maxCreditPerCallCents: refresh.maxCreditPerCallCents,
    maxCreditsPerDayCents: refresh.maxCreditsPerDayCents,
  };
}

/** Withdraw-to-wallet daily cap; 0 = feature disabled (NORMIE/CURIOUS) */
export function getWithdrawDailyLimitCents(
  tier: UserTier | string,
  _userFlags?: Record<string, unknown> | null,
): number {
  return DEFAULTS[tierKey(tier)].dailyLimitCents;
}
