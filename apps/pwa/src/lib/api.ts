const API = process.env.NEXT_PUBLIC_API_BASE!;

const fetchOpts = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body ? JSON.stringify(body) : undefined,
  cache: "no-store",
  credentials: "include",
});

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, fetchOpts(method, body));

  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!res.ok) throw new Error(typeof data === "string" ? data : JSON.stringify(data));
  return data as T;
}

// ---------- 429 and funding response types (match backend: wallet_not_ready, chain_unavailable) ----------

/** 429 per-minute limiter */
export type RateLimit429 = {
  error: "rate_limit";
  retryAfterSeconds: number;
};

/** 429 daily limiter (resets at UTC midnight) */
export type DailyLimit429 = {
  error: "daily_limit";
  retryAfterSeconds: number;
  nextAllowedAt: string;
};

/** 429 for POST /funding/session */
export type FundingSessionDailyLimit429 = DailyLimit429 & {
  limitPerDay: number;
  usedToday: number;
};

/** 429 for POST /users/:id/funding/refresh */
export type FundingRefreshDailyLimit429 = DailyLimit429 & {
  usedCents: number;
  maxCreditsPerDayCents?: number;
};

/** POST /funding/session 200 */
export type FundingSessionOk = {
  provider: "coinbase";
  enabled: true;
  sessionToken: string;
  expiresAt: string;
  wallet: { chain: string; address: `0x${string}` };
  ui: { mode: "fundcard"; title: string; asset: "USDC" };
};

/** POST /funding/session non-200 */
export type FundingSessionError =
  | RateLimit429
  | FundingSessionDailyLimit429
  | { error: "wallet_not_ready" }
  | { error: "funding_session_not_configured" }
  | { error: "funding_disabled" }
  | { error: "session_token_failed" };

export type FundingSessionResponse = FundingSessionOk | FundingSessionError;

/** POST /users/:id/funding/refresh 200 */
export type FundingRefreshOk = {
  userId: string;
  asOf: string;
  wallet: { chain: string; address: `0x${string}` };
  observed: {
    walletAddress: `0x${string}`;
    walletUsdcBalanceMicros: string;
  };
  accounting: {
    accountedPrincipalUsdcMicrosBefore: string;
    accountedPrincipalUsdcMicrosAfter: string;
    deltaMicros: string;
    deltaCents: number;
  };
  result:
    | { status: "SETTLED"; createdPaymentIntents: number; paymentIntentIds: string[] }
    | { status: "NO_CHANGE" };
};

/** POST /users/:id/funding/refresh non-200 */
export type FundingRefreshError =
  | RateLimit429
  | FundingRefreshDailyLimit429
  | { error: "wallet_not_ready" }
  | { error: "funding_disabled" }
  | { error: "chain_unavailable" }
  | { error: "chain_error" };

export type FundingRefreshResponse = FundingRefreshOk | FundingRefreshError;

/** Helper for UI: consistent countdown. Works with req() that throws new Error(JSON.stringify(body)). */
export type RetryInfo = {
  kind: "rate_limit" | "daily_limit";
  retryAfterSeconds: number;
  nextAllowedAt?: string;
};

export function getRetryInfo(err: unknown): RetryInfo | null {
  const extract = (o: Record<string, unknown> | null): RetryInfo | null => {
    if (!o || typeof o !== "object") return null;
    if (o.error === "rate_limit" && typeof o.retryAfterSeconds === "number") {
      return { kind: "rate_limit", retryAfterSeconds: o.retryAfterSeconds };
    }
    if (o.error === "daily_limit" && typeof o.retryAfterSeconds === "number") {
      return {
        kind: "daily_limit",
        retryAfterSeconds: o.retryAfterSeconds,
        nextAllowedAt: typeof o.nextAllowedAt === "string" ? o.nextAllowedAt : undefined,
      };
    }
    return null;
  };
  const direct = extract(err as Record<string, unknown>);
  if (direct) return direct;
  if (err instanceof Error && err.message) {
    try {
      return extract(JSON.parse(err.message) as Record<string, unknown>);
    } catch {
      return null;
    }
  }
  return null;
}

export type TodayCard =
  | {
      type: "weather_wednesday";
      challengeId: string;
      eventId: string;
      title: string;
      prompt: string;
      unit: "F" | "C";
      maxAmountCents: number;
      scale?: number;
      choices?: Array<{ choice: string; amountCents: number }>;
      scheduledFor: string;
      needsInput: true;
    }
  | {
      type: "temperature_daily";
      challengeId: string;
      userChallengeId: string;
      eventId: string;
      title: string;
      prompt: string;
      unit: "F" | "C";
      maxAmountCents: number;
      scale?: number;
      availableScales?: number[];
      scheduledFor: string;
      needsInput: true;
    }
  | {
      type: "dice_daily";
      challengeId: string;
      userChallengeId: string;
      eventId: string;
      title: string;
      prompt: string;
      sides: number;
      unitAmountCents: number;
      maxAmountCents: number;
      scheduledFor: string;
      needsInput: true;
      multiDice?: number;
      multiplier?: number;
    }
  | {
      type: "envelopes_100";
      challengeId: string;
      userChallengeId: string;
      title: string;
      prompt: string;
      needsInput: true;
      remainingCount: number;
      usedCount: number;
      min: number;
      max: number;
      unitAmountCents: number;
      maxDrawsPerDay?: number;
      drewToday?: boolean;
      cadence?: "daily" | "weekly";
      order?: "random" | "reverse";
    }
  | { type: string; [k: string]: unknown };

export type DiceTodayCard = Extract<TodayCard, { type: "dice_daily" }>;
export type EnvelopesTodayCard = Extract<TodayCard, { type: "envelopes_100" }>;

export type TodayBanner =
  | {
      type: "commit_pending";
      pendingCount: number;
      label: string;
      subLabel?: string;
    }
  | {
      type: "needs_input";
      pendingCount: number;
      label: string;
      subLabel?: string;
    }
  | {
      type: "waiting_for_funds";
      message: string;
      lastRefreshAt?: string;
    };

export type TodayResponse = {
  userId: string;
  banner?: TodayBanner;
  cards: TodayCard[];
};

export type HomeContext = "pwa" | "miniapp";

export type Tier = "NORMIE" | "CURIOUS" | "POWER" | "DEV";
export type FundingUiMode = "fundcard" | "open_in_wallet";
export type FundingDeeplinkKind = "env" | "generated" | "none";
export type FundingRail = "FUND_CARD" | "OPEN_IN_WALLET" | "MANUAL_REFRESH_ONLY";
export type EnvelopeCadence = "daily" | "weekly";
export type EnvelopeOrder = "random" | "reverse";

export type FeatureActions = {
  canFund: boolean;
  preferredFundingRail: FundingRail;
  canWithdrawToWallet: boolean;
  canWithdrawToBank: boolean;
  canDiceTwoDice: boolean;
  canDiceMultiplier10: boolean;
  canDiceChooseSides: boolean;
  canEnvelopesTwoPerDay: boolean;
  canEnvelopesWeeklyCadence: boolean;
  canEnvelopesReverseOrder: boolean;
  canStreakShield: boolean;
  canMakeupSave: boolean;
  canPushReminders: boolean;
  canWeeklyRecapEmail: boolean;
};

export type ChallengeLimits = {
  dice: {
    allowedSides: number[];
    allowedMultiDice: number[];
    allowedMultipliers: number[];
    maxSides?: number;
  };
  envelopes100: {
    allowedCadence: EnvelopeCadence[];
    allowedOrder: EnvelopeOrder[];
    maxDrawsPerDayMax: number;
    maxDrawsPerWeekMax?: number;
  };
};

export type TierLimits = {
  fundingSessionsPerMinute: number;
  fundingSessionsPerDay: number;
  maxCreditPerCallCents: number;
  maxCreditsPerDayCents: number;
  minDepositCents: number;
  maxDepositCents: number;
  withdrawDailyLimitCents: number;
  dailyAutoSaveCapCents: number;
  perRunAutoSaveCapCents: number;
  maxSingleTempSaveCents: number;
  challenges: ChallengeLimits;
};

export type UserConfigResponse = {
  userId: string;
  tier: Tier;
  flags: Record<string, unknown>;
  actions: FeatureActions;
  limits: TierLimits;
};

export type PatchUserChallengeSettingsBody = {
  autoCommit?: boolean;
  catchUp?: boolean;
  maxCatchUpEvents?: number;
  scaleOverride?: 1 | 10;
  dice?: {
    sides?: 6 | 12 | 20 | 100;
    multiDice?: 1 | 2;
    multiplier?: 1 | 10;
  };
  envelopes?: {
    cadence?: EnvelopeCadence;
    order?: EnvelopeOrder;
    maxDrawsPerDay?: 1 | 2;
  };
};

export type PatchUserChallengeSettingsResponse = {
  userChallengeId: string;
  userId: string;
  templateSlug: string | null;
  settings: Record<string, unknown>;
  updatedAt: string;
};

export type DrawEnvelopeResult = {
  envelope: number;
  amountCents: number;
  remainingCount: number;
  done?: boolean;
};

export type RollDiceResult = {
  roll?: number;
  amountCents: number;
};

export type RollDiceEventResult = {
  status?: "already_committed" | "saved";
  amountCents?: number;
  roll?: number;
  rollBreakdown?: number[];
  multiplier?: number;
};

export type SetTemperatureResult = {
  status?: "already_committed" | "saved";
  amountCents?: number;
};

export type SetWeatherChoiceResult = {
  status?: "already_committed" | "saved";
  amountCents?: number;
};

export type AuthMe = {
  userId: string;
  email?: string;
  tier: string;
  flags: Record<string, boolean>;
};

export const api = {
  startAuth: (email: string, returnTo?: string | null) =>
    req<{ ok: boolean }>("POST", "/auth/start", { email, returnTo: returnTo ?? undefined }),

  getMe: async (): Promise<AuthMe> => {
    const res = await fetch(`${API}/auth/me`, fetchOpts("GET"));
    if (res.status === 401) throw new Error("unauthorized");
    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    if (!res.ok) throw new Error(typeof data === "string" ? data : JSON.stringify(data));
    return data as AuthMe;
  },

  logout: () => req<{ ok: boolean }>("POST", "/auth/logout", {}),

  createUser: () => req<{ userId: string }>("POST", "/users", {}),

  getAccounts: (userId: string) => req<unknown>("GET", `/users/${userId}/accounts`),

  getBalance: (accountId: string) =>
    req<{ balanceCents: number }>("GET", `/ledger/accounts/${accountId}/balance`),

  getFlags: (userId: string) =>
    req<{ tier: string; flags: Record<string, boolean> }>("GET", `/users/${userId}/flags`),

  getConfig: (userId: string) =>
    req<UserConfigResponse>("GET", `/users/${userId}/config`),

  getTxHistory: (userId: string) =>
    req<{
      transactions: Array<{ occurredAt: string; type: string; amountCents: number; memo?: string }>;
    }>("GET", `/users/${userId}/transactions`),

  startChallenge: (input: {
    userId: string;
    templateSlug: string;
    settings?: Record<string, unknown>;
    primeToday?: boolean;
  }) =>
    req<{ userChallengeId: string; nextRunAt?: string; primedEventId?: string }>(
      "POST",
      `/challenges/start?primeToday=${input.primeToday ? "true" : "false"}`,
      {
        userId: input.userId,
        templateSlug: input.templateSlug,
        startDate: new Date().toISOString(),
        settings: input.settings ?? {},
      },
    ),

  runDueChallenges: (userId: string) =>
    req<unknown>("POST", `/users/${userId}/challenges/run-due`, {}),

  drawEnvelope: (challengeId: string) =>
    req<DrawEnvelopeResult>("POST", `/challenges/${challengeId}/draw`, {}),

  rollDice: (challengeId: string) => req<RollDiceResult>("POST", `/challenges/${challengeId}/roll`, {}),

  createDeposit: (userId: string, amountCents: number) =>
    req<{ id: string; paymentIntent?: { id: string } }>("POST", "/payments/deposits", {
      userId,
      amountCents,
      idempotencyKey: `pwa_dep_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    }),

  settleDeposit: (paymentIntentId: string) =>
    req<unknown>("POST", "/webhooks/deposits/settled", { paymentIntentId }),

  requestWithdraw: (userId: string, amountCents: number) =>
    req<{ id: string }>("POST", "/payments/withdrawals", {
      userId,
      amountCents,
      idempotencyKey: `pwa_wd_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    }),

  markWithdrawPaid: (paymentIntentId: string) =>
    req<unknown>("POST", "/webhooks/withdrawals/paid", { paymentIntentId }),

  getTodayCards: (userId: string) =>
    req<TodayResponse>("GET", `/users/${userId}/challenges/today`),

  getHome: (userId: string, options?: { context?: HomeContext }) =>
    req<{
      userId?: string;
      config: {
        tier: Tier;
        flags: Record<string, unknown>;
        actions: FeatureActions;
        limits: TierLimits;
      };
      wallet?: {
        ready: boolean;
        provisioning?: boolean;
        type: "SMART" | "EXTERNAL" | "EOA";
        chain: string;
        address: string | null;
      };
      funding?: {
        enabled: boolean;
        provider?: string | null;
        rail?: string;
        limits?: {
          minDepositCents: number;
          maxDepositCents: number;
          maxCreditPerCallCents: number;
          maxCreditsPerDayCents: number;
        };
        reason?: "not_configured" | "wallet_not_ready";
        disabledReason?: "not_configured" | "chain_unavailable" | "tier_restricted";
        lastRefreshAt?: string | null;
        lastObservedBalanceMicros?: string | null;
        ui?: {
          primaryCtaLabel: string;
          secondaryCtaLabel: string;
          mode?: FundingUiMode;
          title?: string;
          asset?: string;
          deeplink?: string;
          deeplinkKind: FundingDeeplinkKind;
          helperText?: string;
        };
      };
      streak: {
        userId?: string;
        todayCompleted: boolean;
        currentStreakDays: number;
        bestStreakDays: number;
        lastCompletedDateUtc: string | null;
        streakStatus?: "ok" | "needs_recovery" | "decayed";
        streakShieldAvailable?: boolean;
        streakShieldUsedAtUtc?: string | null;
        recoveryTarget?: number | null;
      };
      stash: {
        stashBalanceCents: number;
        vaultValueCents: number;
        totalDisplayCents: number;
        lastMarkedAt: string | null;
        markAgeSeconds: number | null;
        isStale: boolean;
        details?: Record<string, unknown>;
      };
      stashAccountId: string;
      today: { cards: TodayCard[]; banner?: TodayBanner };
      activeChallenges: Array<{
        userChallengeId: string;
        name: string;
        templateSlug: string | null;
        progress?: string;
        settings?: Record<string, unknown>;
        bounds?: {
          dice?: ChallengeLimits["dice"];
          envelopes100?: ChallengeLimits["envelopes100"];
        };
      }>;
    }>(
      "GET",
      `/users/${userId}/home${options?.context ? `?context=${encodeURIComponent(options.context)}` : ""}`,
    ),

  fundingRefresh: (userId: string, body?: { mode?: string; clientContext?: Record<string, string> }) =>
    req<FundingRefreshOk>("POST", `/users/${userId}/funding/refresh`, body ?? {}),

  getFundingSession: (body?: { returnTo?: string; context?: "pwa" | "miniapp" }) =>
    req<FundingSessionOk>("POST", "/funding/session", body ?? {}),

  walletProvision: (userId: string) =>
    req<{ ok: boolean; wallet: { address: string; walletType: string; chain: string } }>(
      "POST",
      `/users/${userId}/wallet/provision`,
      {},
    ),

  getActiveChallenges: (userId: string) =>
    req<{
      userId: string;
      challenges: Array<{
        userChallengeId: string;
        name: string;
        templateSlug: string | null;
        progress?: string;
        settings?: Record<string, unknown>;
        bounds?: {
          dice?: ChallengeLimits["dice"];
          envelopes100?: ChallengeLimits["envelopes100"];
        };
      }>;
    }>("GET", `/users/${userId}/challenges/active`),

  getStreak: (userId: string) =>
    req<{
      userId: string;
      todayCompleted: boolean;
      currentStreakDays: number;
      bestStreakDays: number;
      lastCompletedDateUtc: string | null;
      streakStatus?: "ok" | "needs_recovery" | "decayed";
      streakShieldAvailable?: boolean;
      streakShieldUsedAtUtc?: string | null;
      recoveryTarget?: number | null;
    }>("GET", `/users/${userId}/streak`),

  setWeatherChoice: (challengeId: string, eventId: string, choice: string) =>
    req<SetWeatherChoiceResult>("POST", `/challenges/${challengeId}/events/${eventId}/set-weather`, { choice }),

  setTemperature: (
    challengeId: string,
    eventId: string,
    body:
      | { mode: "manual"; temp: number; unit?: "F" | "C" }
      | { mode: "gps"; lat: number; lon: number; unit?: "F" | "C" }
      | { mode: "place"; zip?: string; query?: string; unit?: "F" | "C" },
  ) => req<SetTemperatureResult>("POST", `/challenges/${challengeId}/events/${eventId}/set-temperature`, body),

  updateChallengeSettings: (
    userId: string,
    userChallengeId: string,
    body: PatchUserChallengeSettingsBody,
  ) =>
    req<PatchUserChallengeSettingsResponse>(
      "PATCH",
      `/users/${userId}/challenges/${userChallengeId}/settings`,
      body,
    ),

  rollDiceEvent: (
    challengeId: string,
    eventId: string,
    body?: { sides?: 6 | 12 | 20 | 100; multiDice?: 1 | 2; multiplier?: 1 | 10 },
  ) =>
    req<RollDiceEventResult>("POST", `/challenges/${challengeId}/events/${eventId}/roll`, body ?? {}),

  commitPending: (userId: string, limit = 200) =>
    req<{ committedCents?: number; perRunCapHit?: boolean; skippedCapCount?: number }>(
      "POST",
      `/users/${userId}/challenges/commit-pending?limit=${limit}`,
      {},
    ),

  getVapidPublicKey: () =>
    fetch(`${API}/push/vapid-public`, { credentials: "include" }).then(async (r) => {
      if (!r.ok) throw new Error("Push not configured");
      const d = await r.json();
      return d.vapidPublicKey as string;
    }),

  getPushStatus: () =>
    req<{ enabled: boolean; subscriptionCount: number }>("GET", "/push/status"),

  pushSubscribe: (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    req<{ ok: boolean }>("POST", "/push/subscribe", subscription),

  pushUnsubscribe: (endpoint: string) =>
    req<{ ok: boolean }>("POST", "/push/unsubscribe", { endpoint }),
};
