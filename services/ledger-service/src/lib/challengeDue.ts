/**
 * Challenge due-window logic: one place that answers "is this challenge expecting
 * an action right now?" per challenge type, based on each challenge's schedule rules.
 * Used by: today cards, push reminders, future streak logic.
 */

// --- Date helpers (UTC) ---
function utcDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDaysUtc(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 24 * 60 * 60 * 1000);
}

function toDateStringUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dayOfWeekToNumber(dow: string): number {
  const v = dow.trim().toUpperCase();
  const map: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
  if (map[v] !== undefined) return map[v];
  throw new Error(`Invalid dayOfWeek: ${dow}`);
}

/** Next occurrence of weekday (0–6) on or after start, at 00:00 UTC */
function nextWeekdayUtc(start: Date, weekday: number): Date {
  const d = utcDateOnly(start);
  const current = d.getUTCDay();
  const delta = (weekday - current + 7) % 7;
  return addDaysUtc(d, delta === 0 ? 0 : delta);
}

/** First "run" date for weekly challenge: next occurrence of weekday on or after startDate */
function firstWeeklyRunUtc(startDate: Date, weekday: number): Date {
  return nextWeekdayUtc(startDate, weekday);
}

/** Last occurrence of weekday (0–6) on or before d, at 00:00 UTC. Defines "start of this week" for weekly windows. */
function lastWeekdayOnOrBeforeUtc(d: Date, weekday: number): Date {
  const dayOnly = utcDateOnly(d);
  const dayNum = dayOnly.getUTCDay();
  const delta = (dayNum - weekday + 7) % 7;
  return addDaysUtc(dayOnly, -delta);
}

export type ExpectedAction = "draw" | "roll" | "input" | "save";

export type ChallengeDueResult = {
  due: boolean;
  dueSinceUtc: Date | null;
  dueUntilUtc: Date | null;
  dueWindowKey: string | null;
  expectedAction: ExpectedAction;
  amountKnown: boolean;
  /** Optional: week number (1-based) for 52-week; envelope remaining count for 100_envelopes */
  meta?: { weekNumber?: number; remainingEnvelopes?: number };
};

type Rules = {
  type?: string;
  schedule?: { type?: string; dayOfWeek?: string; daysOfWeek?: string[] };
  weekday?: number;
  week1AmountCents?: number;
  incrementCents?: number;
  maxWeeks?: number;
  min?: number;
  max?: number;
};

type EnvelopeState = { remaining?: number[]; used?: number[] };

/**
 * Returns whether this challenge has a due window that includes `nowUtc`,
 * and the window key for idempotent reminders.
 * Does NOT check if the user has already completed the action (caller uses DB for that).
 */
export function getChallengeDueWindow(
  params: {
    templateSlug: string | null;
    rules: Rules;
    startDate: Date;
    nowUtc: Date;
    /** For 100_envelopes: pass state; if remaining is empty, not due */
    envelopeState?: EnvelopeState | null;
    /** For 100_envelopes: pass true if user already drew today (no reminder) */
    envelopeDrewToday?: boolean;
  },
): ChallengeDueResult {
  const { templateSlug, rules, startDate, nowUtc, envelopeState, envelopeDrewToday } = params;
  const schedule = rules.schedule ?? {};
  const type = rules.type ?? "";
  const today = utcDateOnly(nowUtc);
  const defaultNotDue: ChallengeDueResult = {
    due: false,
    dueSinceUtc: null,
    dueUntilUtc: null,
    dueWindowKey: null,
    expectedAction: "input",
    amountKnown: false,
  };

  // --- 52-Week Challenge: weekly, save amount = week number ---
  // Rule: Save week 1 = $1, week 2 = $2, … week 52 = $52. Due once per week window (anchor day starts the week); completion valid anytime in that window.
  if (type === "weekly_increment" || templateSlug === "52_week") {
    const weekday = typeof schedule.dayOfWeek === "string"
      ? dayOfWeekToNumber(schedule.dayOfWeek)
      : Number(rules.weekday ?? 1);
    const firstRun = firstWeeklyRunUtc(startDate, weekday);
    const weekStart = lastWeekdayOnOrBeforeUtc(nowUtc, weekday);
    if (weekStart < firstRun) return defaultNotDue;
    const weeksSinceStart = Math.floor(
      (weekStart.getTime() - firstRun.getTime()) / (7 * 24 * 3600 * 1000),
    );
    const weekNumber = weeksSinceStart + 1;
    const maxWeeks = Number(rules.maxWeeks ?? 52);
    if (weekNumber < 1 || weekNumber > maxWeeks) return defaultNotDue;

    const weekEnd = addDaysUtc(weekStart, 7);
    const due = nowUtc >= weekStart && nowUtc < weekEnd;
    const dueWindowKey = toDateStringUtc(weekStart);
    return {
      due,
      dueSinceUtc: due ? weekStart : null,
      dueUntilUtc: due ? weekEnd : null,
      dueWindowKey,
      expectedAction: "save",
      amountKnown: true,
      meta: { weekNumber },
    };
  }

  // --- Weather Wednesday: weekly on Wednesday ---
  // Rule: Every Wednesday save an amount (e.g. based on weather). Due Wed 00:00–Thu 00:00 UTC.
  if (type === "weather_wednesday" || templateSlug === "weather_wednesday") {
    const days = Array.isArray(schedule.daysOfWeek) ? schedule.daysOfWeek : ["WED"];
    const weekday = dayOfWeekToNumber(days[0] ?? "WED");
    if (today.getUTCDay() !== weekday) return defaultNotDue;
    const wedStart = today;
    const wedEnd = addDaysUtc(wedStart, 1);
    const due = nowUtc >= wedStart && nowUtc < wedEnd;
    return {
      due,
      dueSinceUtc: due ? wedStart : null,
      dueUntilUtc: due ? wedEnd : null,
      dueWindowKey: toDateStringUtc(wedStart),
      expectedAction: "input",
      amountKnown: false,
    };
  }

  // --- Temperature Daily: daily, input temperature → save ---
  // Rule: Every day save an amount equal to today's temperature (or scaled). Due each UTC day.
  if (type === "temperature" || templateSlug === "temperature_daily") {
    const dayEnd = addDaysUtc(today, 1);
    const due = nowUtc >= today && nowUtc < dayEnd;
    return {
      due,
      dueSinceUtc: due ? today : null,
      dueUntilUtc: due ? dayEnd : null,
      dueWindowKey: toDateStringUtc(today),
      expectedAction: "input",
      amountKnown: false,
    };
  }

  // --- Dice (daily or weekly): roll to determine amount ---
  // Rule: Daily = roll once per day; weekly = roll once per week (full week window). Amount from dice (e.g. 1–6 × $1).
  if (type === "dice" || templateSlug === "dice_daily" || templateSlug === "dice") {
    const isWeekly = schedule.type === "weekly";
    if (isWeekly) {
      const weekday = typeof schedule.dayOfWeek === "string"
        ? dayOfWeekToNumber(schedule.dayOfWeek)
        : 1;
      const weekStart = lastWeekdayOnOrBeforeUtc(nowUtc, weekday);
      const weekEnd = addDaysUtc(weekStart, 7);
      const due = nowUtc >= weekStart && nowUtc < weekEnd;
      return {
        due,
        dueSinceUtc: due ? weekStart : null,
        dueUntilUtc: due ? weekEnd : null,
        dueWindowKey: due ? toDateStringUtc(weekStart) : null,
        expectedAction: "roll",
        amountKnown: false,
      };
    }
    const dayEnd = addDaysUtc(today, 1);
    const due = nowUtc >= today && nowUtc < dayEnd;
    return {
      due,
      dueSinceUtc: due ? today : null,
      dueUntilUtc: due ? dayEnd : null,
      dueWindowKey: toDateStringUtc(today),
      expectedAction: "roll",
      amountKnown: false,
    };
  }

  // --- 100 Envelopes: daily draw (max 1 per day), until envelopes run out ---
  // Rule: Each day pick one envelope (1–100), save that amount. Complete in 100 days (or extended).
  if (type === "envelopes" || templateSlug === "100_envelopes") {
    const remaining = envelopeState?.remaining ?? [];
    if (remaining.length === 0) return defaultNotDue;
    if (envelopeDrewToday) return defaultNotDue;
    const dayEnd = addDaysUtc(today, 1);
    const due = nowUtc >= today && nowUtc < dayEnd;
    return {
      due,
      dueSinceUtc: due ? today : null,
      dueUntilUtc: due ? dayEnd : null,
      dueWindowKey: toDateStringUtc(today),
      expectedAction: "draw",
      amountKnown: false,
      meta: { remainingEnvelopes: remaining.length },
    };
  }

  return defaultNotDue;
}
