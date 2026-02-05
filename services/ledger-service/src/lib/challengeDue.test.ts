/**
 * Unit tests for challenge due-window logic. Run: npx tsx src/lib/challengeDue.test.ts
 */
import { strict as assert } from "node:assert";
import { getChallengeDueWindow } from "./challengeDue.js";

function iso(ymd: string): Date {
  return new Date(ymd + "T12:00:00.000Z");
}

// --- Temperature Daily: due today, no event → due ---
function testTemperatureDueToday() {
  const now = iso("2026-02-05");
  const r = getChallengeDueWindow({
    templateSlug: "temperature_daily",
    rules: { type: "temperature", schedule: { type: "daily" } },
    startDate: iso("2026-01-01"),
    nowUtc: now,
  });
  assert.equal(r.due, true);
  assert.equal(r.dueWindowKey, "2026-02-05");
  assert.equal(r.expectedAction, "input");
  assert.equal(r.amountKnown, false);
}

// --- Temperature: not due on a different "today" (caller's now is that day) ---
function testTemperatureDueWindowBounds() {
  const now = iso("2026-02-05");
  const r = getChallengeDueWindow({
    templateSlug: "temperature_daily",
    rules: { type: "temperature" },
    startDate: iso("2026-01-01"),
    nowUtc: now,
  });
  assert.equal(r.due, true);
  assert.ok(r.dueSinceUtc && r.dueUntilUtc);
  assert.ok(now >= r.dueSinceUtc! && now < r.dueUntilUtc!);
}

// --- Weather Wednesday: Tuesday → not due ---
function testWeatherWednesdayTuesday() {
  const tuesday = iso("2026-02-03"); // Tue
  const r = getChallengeDueWindow({
    templateSlug: "weather_wednesday",
    rules: { type: "weather_wednesday", schedule: { daysOfWeek: ["WED"] } },
    startDate: iso("2026-01-01"),
    nowUtc: tuesday,
  });
  assert.equal(r.due, false);
  assert.equal(r.dueWindowKey, null);
}

// --- Weather Wednesday: Wednesday → due ---
function testWeatherWednesdayWednesday() {
  const wed = iso("2026-02-04"); // Wed
  const r = getChallengeDueWindow({
    templateSlug: "weather_wednesday",
    rules: { type: "weather_wednesday", schedule: { daysOfWeek: ["WED"] } },
    startDate: iso("2026-01-01"),
    nowUtc: wed,
  });
  assert.equal(r.due, true);
  assert.equal(r.dueWindowKey, "2026-02-04");
  assert.equal(r.expectedAction, "input");
}

// --- 52-week: full week window; Thursday in week of Mon 2026-02-02 → due ---
function test52WeekFullWeekWindow() {
  const thu = iso("2026-02-05"); // Thu; week started Mon 2026-02-02
  const r = getChallengeDueWindow({
    templateSlug: "52_week",
    rules: {
      type: "weekly_increment",
      schedule: { type: "weekly", dayOfWeek: "MON" },
      maxWeeks: 52,
    },
    startDate: iso("2026-01-01"), // first MON on or after = 2026-01-05
    nowUtc: thu,
  });
  assert.equal(r.due, true);
  assert.equal(r.dueWindowKey, "2026-02-02"); // Monday that started this week
  assert.ok(r.dueSinceUtc && r.dueUntilUtc);
  assert.ok(r.dueUntilUtc!.getTime() - r.dueSinceUtc!.getTime() === 7 * 24 * 60 * 60 * 1000);
  assert.equal(r.expectedAction, "save");
  assert.equal(r.amountKnown, true);
  assert.equal(r.meta?.weekNumber, 5); // week 5 from 2026-01-05
}

// --- 52-week: before first week → not due ---
function test52WeekBeforeFirstWeek() {
  const beforeFirst = iso("2026-01-03"); // Sat before first MON 2026-01-05
  const r = getChallengeDueWindow({
    templateSlug: "52_week",
    rules: {
      type: "weekly_increment",
      schedule: { dayOfWeek: "MON" },
      maxWeeks: 52,
    },
    startDate: iso("2026-01-01"),
    nowUtc: beforeFirst,
  });
  assert.equal(r.due, false);
}

// --- 100 Envelopes: remaining > 0, no draw today → due ---
function testEnvelopesRemindable() {
  const now = iso("2026-02-05");
  const r = getChallengeDueWindow({
    templateSlug: "100_envelopes",
    rules: { type: "envelopes", min: 1, max: 100 },
    startDate: iso("2026-01-01"),
    nowUtc: now,
    envelopeState: { remaining: [1, 2, 3], used: [] },
    envelopeDrewToday: false,
  });
  assert.equal(r.due, true);
  assert.equal(r.dueWindowKey, "2026-02-05");
  assert.equal(r.expectedAction, "draw");
  assert.equal(r.meta?.remainingEnvelopes, 3);
}

// --- 100 Envelopes: drew today → not due ---
function testEnvelopesDrewToday() {
  const now = iso("2026-02-05");
  const r = getChallengeDueWindow({
    templateSlug: "100_envelopes",
    rules: { type: "envelopes" },
    startDate: iso("2026-01-01"),
    nowUtc: now,
    envelopeState: { remaining: [1, 2], used: [50] },
    envelopeDrewToday: true,
  });
  assert.equal(r.due, false);
}

// --- 100 Envelopes: remaining empty → not due ---
function testEnvelopesCompleted() {
  const now = iso("2026-02-05");
  const r = getChallengeDueWindow({
    templateSlug: "100_envelopes",
    rules: { type: "envelopes" },
    startDate: iso("2026-01-01"),
    nowUtc: now,
    envelopeState: { remaining: [], used: Array.from({ length: 100 }, (_, i) => i + 1) },
    envelopeDrewToday: false,
  });
  assert.equal(r.due, false);
}

// --- Dice daily: due today ---
function testDiceDailyDue() {
  const now = iso("2026-02-05");
  const r = getChallengeDueWindow({
    templateSlug: "dice_daily",
    rules: { type: "dice", schedule: { type: "daily" } },
    startDate: iso("2026-01-01"),
    nowUtc: now,
  });
  assert.equal(r.due, true);
  assert.equal(r.dueWindowKey, "2026-02-05");
  assert.equal(r.expectedAction, "roll");
}

// --- Dice weekly: full week window (e.g. MON anchor) ---
function testDiceWeeklyFullWeek() {
  const thu = iso("2026-02-05");
  const r = getChallengeDueWindow({
    templateSlug: "dice",
    rules: { type: "dice", schedule: { type: "weekly", dayOfWeek: "MON" } },
    startDate: iso("2026-01-01"),
    nowUtc: thu,
  });
  assert.equal(r.due, true);
  assert.equal(r.dueWindowKey, "2026-02-02");
  assert.ok(r.dueUntilUtc && r.dueSinceUtc);
  assert.ok(r.dueUntilUtc!.getTime() - r.dueSinceUtc!.getTime() === 7 * 24 * 60 * 60 * 1000);
}

const tests: Array<{ name: string; fn: () => void }> = [
  { name: "Temperature: due today", fn: testTemperatureDueToday },
  { name: "Temperature: due window bounds", fn: testTemperatureDueWindowBounds },
  { name: "Weather Wednesday: Tuesday not due", fn: testWeatherWednesdayTuesday },
  { name: "Weather Wednesday: Wednesday due", fn: testWeatherWednesdayWednesday },
  { name: "52-week: full week window", fn: test52WeekFullWeekWindow },
  { name: "52-week: before first week not due", fn: test52WeekBeforeFirstWeek },
  { name: "100 Envelopes: remindable", fn: testEnvelopesRemindable },
  { name: "100 Envelopes: drew today not due", fn: testEnvelopesDrewToday },
  { name: "100 Envelopes: completed not due", fn: testEnvelopesCompleted },
  { name: "Dice daily: due today", fn: testDiceDailyDue },
  { name: "Dice weekly: full week window", fn: testDiceWeeklyFullWeek },
];

function run() {
  let passed = 0;
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (e) {
      console.error(`  ✗ ${name}`);
      console.error(e);
      failed++;
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
