"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import {
  api,
  type ChallengeLimits,
  type EnvelopeCadence,
  type EnvelopeOrder,
} from "@/lib/api";
import { setUserId as saveUserId } from "@/lib/session";

const DEFAULT_CHALLENGE_LIMITS: ChallengeLimits = {
  dice: {
    allowedSides: [6],
    allowedMultiDice: [1],
    allowedMultipliers: [1],
    maxSides: 100,
  },
  envelopes100: {
    allowedCadence: ["daily"],
    allowedOrder: ["random"],
    maxDrawsPerDayMax: 1,
    maxDrawsPerWeekMax: 7,
  },
};

export default function ChallengesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [userId, setUserId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [activeChallengeId, setActiveChallengeId] = useState<string>("");
  const [activeChallenges, setActiveChallenges] = useState<Array<{
    userChallengeId: string;
    name: string;
    templateSlug: string | null;
    progress?: string;
    settings?: Record<string, unknown>;
    bounds?: { dice?: ChallengeLimits["dice"]; envelopes100?: ChallengeLimits["envelopes100"] };
  }>>([]);
  const [limits, setLimits] = useState<{ challenges: ChallengeLimits }>({
    challenges: DEFAULT_CHALLENGE_LIMITS,
  });
  const [loadingUser, setLoadingUser] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refreshContext(uid: string) {
    const [active, config] = await Promise.all([
      api.getActiveChallenges(uid),
      api.getConfig(uid),
    ]);
    setActiveChallenges(active.challenges ?? []);
    setLimits({
      challenges: (config.limits as { challenges: ChallengeLimits })?.challenges ?? DEFAULT_CHALLENGE_LIMITS,
    });
  }

  useEffect(() => {
    (async () => {
      try {
        setLoadingUser(true);
        const me = await api.getMe();
        const uid = me.userId;
        saveUserId(uid);
        setUserId(uid);
        await refreshContext(uid);
        setError(null);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Failed to initialize user";
        if (msg === "unauthorized") {
          const returnTo = pathname ? encodeURIComponent(pathname) : "";
          router.replace(returnTo ? `/login?returnTo=${returnTo}` : "/login");
          return;
        }
        setError(msg);
      } finally {
        setLoadingUser(false);
      }
    })();
  }, [router, pathname]);

  async function start(slug: string) {
    if (!userId) return;
    try {
      setStatus(`Starting ${slug}…`);
      const res = await api.startChallenge({
        userId,
        templateSlug: slug,
        primeToday: true,
      });
      void api.trackEvent({
        event: "challenge_started",
        metadata: {
          templateSlug: slug,
          userChallengeId: res.userChallengeId,
          context: "pwa",
          primeToday: true,
        },
      }).catch(() => undefined);
      setActiveChallengeId(res.userChallengeId);
      setStatus(`Started: ${res.userChallengeId}`);
      await refreshContext(userId);
      if (res.primedEventId) {
        localStorage.setItem("focusEventId", res.primedEventId);
      }
      router.push("/");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to start challenge";
      setStatus(`Error: ${msg}`);
    }
  }

  async function runDue() {
    if (!userId) return;
    try {
      setStatus("Running due challenges…");
      await api.runDueChallenges(userId);
      await refreshContext(userId);
      setStatus("Done.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to run due challenges";
      setStatus(`Error: ${msg}`);
    }
  }

  async function draw() {
    if (!activeChallengeId) return;
    try {
      const r = await api.drawEnvelope(activeChallengeId);
      setStatus(
        `Envelope: ${r.envelope} (+$${(r.amountCents / 100).toFixed(
          2,
        )}), remaining: ${r.remainingCount}`,
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to draw envelope";
      setStatus(`Error: ${msg}`);
    }
  }

  async function roll() {
    if (!activeChallengeId) return;
    try {
      const r = await api.rollDice(activeChallengeId);
      setStatus(`Rolled: ${r.roll ?? "?"} (+$${(r.amountCents / 100).toFixed(2)})`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to roll dice";
      setStatus(`Error: ${msg}`);
    }
  }

  async function patchSettings(
    userChallengeId: string,
    body: Parameters<typeof api.updateChallengeSettings>[2],
  ) {
    if (!userId) return;
    try {
      await api.updateChallengeSettings(userId, userChallengeId, body);
      await refreshContext(userId);
      setStatus("Settings saved ✅");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to save settings";
      setStatus(`Error: ${msg}`);
    }
  }

  return (
    <main className="mx-auto max-w-xl p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Challenges</h1>
        <Link className="underline text-sm opacity-70" href="/">
          ← Back
        </Link>
      </header>

      <section className="rounded-xl border p-5 space-y-2">
        <h2 className="font-semibold">Start</h2>
        {loadingUser && <div className="text-sm opacity-70">Loading user…</div>}
        {error && <div className="text-sm text-red-600">{error}</div>}
        <div className="flex flex-col gap-2">
          <button
            className="rounded bg-black text-white px-4 py-2"
            onClick={() => start("52_week")}
            disabled={!userId}
          >
            Start 52-week
          </button>
          <button
            className="rounded bg-black text-white px-4 py-2"
            onClick={() => start("weather_wednesday")}
            disabled={!userId}
          >
            Start Weather Wednesday
          </button>
          <button
            className="rounded bg-black text-white px-4 py-2"
            onClick={() => start("temperature_daily")}
            disabled={!userId}
          >
            Start Temperature Daily
          </button>
          <button
            className="rounded bg-black text-white px-4 py-2"
            onClick={() => start("dice_daily")}
            disabled={!userId}
          >
            Start Dice Daily
          </button>
          <button
            className="rounded bg-black text-white px-4 py-2"
            onClick={() => start("100_envelopes")}
            disabled={!userId}
          >
            Start 100 Envelopes
          </button>
          <button
            className="rounded bg-black text-white px-4 py-2"
            onClick={() => start("dice")}
            disabled={!userId}
          >
            Start dice
          </button>
        </div>
      </section>

      <section className="rounded-xl border p-5 space-y-2">
        <h2 className="font-semibold">Actions</h2>
        <div className="flex gap-2 flex-wrap">
          <button className="rounded border px-4 py-2" onClick={runDue} disabled={!userId}>
            Run due (52-week)
          </button>
          <button className="rounded border px-4 py-2" onClick={draw} disabled={!activeChallengeId}>
            Draw envelope
          </button>
          <button className="rounded border px-4 py-2" onClick={roll} disabled={!activeChallengeId}>
            Roll dice
          </button>
        </div>
        <div className="text-sm opacity-70 break-words">{status}</div>
        <div className="text-xs opacity-60">Active challenge: {activeChallengeId || "none"}</div>
      </section>

      <section className="rounded-xl border p-5 space-y-4">
        <h2 className="font-semibold">Challenge Settings</h2>
        {activeChallenges.length === 0 && (
          <p className="text-sm opacity-70">No active challenges yet.</p>
        )}
        {activeChallenges.map((ch) => {
          const s = (ch.settings ?? {}) as Record<string, unknown>;
          const dice = (s.dice ?? {}) as {
            sides?: 6 | 12 | 20 | 100;
            multiDice?: 1 | 2;
            multiplier?: 1 | 10;
          };
          const envelopes = (s.envelopes ?? {}) as {
            cadence?: "daily" | "weekly";
            order?: "random" | "reverse";
            maxDrawsPerDay?: 1 | 2;
          };
          return (
            <div key={ch.userChallengeId} className="rounded border p-3 space-y-2">
              <div className="text-sm font-medium">
                {ch.name} {ch.progress ? <span className="opacity-70">({ch.progress})</span> : null}
              </div>

              {(ch.templateSlug === "dice_daily" || ch.templateSlug === "dice") && (() => {
                const dl = ch.bounds?.dice ?? limits.challenges.dice;
                const allowedSides = dl.allowedSides.length > 0 ? dl.allowedSides : [6];
                const canTwoDice = dl.allowedMultiDice.includes(2);
                const canMultiplier10 = dl.allowedMultipliers.includes(10);
                return (
                  <div className="space-y-2">
                    <div className="text-xs opacity-70">Dice defaults</div>
                    <div className="flex flex-wrap gap-2">
                      {allowedSides.map((side) => (
                        <button
                          key={side}
                          className={`rounded border px-3 py-1 text-xs ${(dice.sides ?? 6) === side ? "bg-black text-white" : ""}`}
                          onClick={() =>
                            patchSettings(ch.userChallengeId, {
                              dice: {
                                sides: side as 6 | 12 | 20 | 100,
                                multiDice: (dice.multiDice ?? 1) as 1 | 2,
                                multiplier: (dice.multiplier ?? 1) as 1 | 10,
                              },
                            })
                          }
                        >
                          D{side}
                        </button>
                      ))}
                      {canTwoDice && (
                        <button
                          className={`rounded border px-3 py-1 text-xs ${(dice.multiDice ?? 1) === 2 ? "bg-black text-white" : ""}`}
                          onClick={() =>
                            patchSettings(ch.userChallengeId, {
                              dice: {
                                sides: (dice.sides ?? 6) as 6 | 12 | 20 | 100,
                                multiDice: (dice.multiDice ?? 1) === 2 ? 1 : 2,
                                multiplier: (dice.multiDice ?? 1) === 2 ? (dice.multiplier ?? 1) : 1,
                              },
                            })
                          }
                        >
                          2 dice
                        </button>
                      )}
                      {canMultiplier10 && (
                        <button
                          className={`rounded border px-3 py-1 text-xs ${(dice.multiplier ?? 1) === 10 ? "bg-black text-white" : ""}`}
                          onClick={() =>
                            patchSettings(ch.userChallengeId, {
                              dice: {
                                sides: (dice.sides ?? 6) as 6 | 12 | 20 | 100,
                                multiDice: (dice.multiplier ?? 1) === 10 ? (dice.multiDice ?? 1) : 1,
                                multiplier: (dice.multiplier ?? 1) === 10 ? 1 : 10,
                              },
                            })
                          }
                        >
                          ×10
                        </button>
                      )}
                    </div>
                  </div>
                );
              })()}

              {ch.templateSlug === "100_envelopes" && (() => {
                const el = ch.bounds?.envelopes100 ?? limits.challenges.envelopes100;
                const allowedCadence: EnvelopeCadence[] =
                  el.allowedCadence.length > 0 ? el.allowedCadence : ["daily"];
                const allowedOrder: EnvelopeOrder[] =
                  el.allowedOrder.length > 0 ? el.allowedOrder : ["random"];
                const maxDrawsMax = Math.max(1, el.maxDrawsPerDayMax ?? 1);
                const drawOptions = Array.from({ length: maxDrawsMax }, (_, i) => (i + 1) as 1 | 2);
                return (
                  <div className="space-y-2">
                    <div className="text-xs opacity-70">Envelope defaults</div>
                    <div className="flex flex-wrap gap-2">
                      {allowedCadence.includes("daily") && (
                        <button
                          className={`rounded border px-3 py-1 text-xs ${(envelopes.cadence ?? "daily") === "daily" ? "bg-black text-white" : ""}`}
                          onClick={() =>
                            patchSettings(ch.userChallengeId, {
                              envelopes: {
                                cadence: "daily",
                                order: (envelopes.order ?? "random") as "random" | "reverse",
                                maxDrawsPerDay: Math.min((envelopes.maxDrawsPerDay ?? 1) as number, maxDrawsMax) as 1 | 2,
                              },
                            })
                          }
                        >
                          Daily
                        </button>
                      )}
                      {allowedCadence.includes("weekly") && (
                        <button
                          className={`rounded border px-3 py-1 text-xs ${(envelopes.cadence ?? "daily") === "weekly" ? "bg-black text-white" : ""}`}
                          onClick={() =>
                            patchSettings(ch.userChallengeId, {
                              envelopes: {
                                cadence: "weekly",
                                order: (envelopes.order ?? "random") as "random" | "reverse",
                                maxDrawsPerDay: Math.min((envelopes.maxDrawsPerDay ?? 1) as number, maxDrawsMax) as 1 | 2,
                              },
                            })
                          }
                        >
                          Weekly
                        </button>
                      )}
                      {allowedOrder.includes("random") && (
                        <button
                          className={`rounded border px-3 py-1 text-xs ${(envelopes.order ?? "random") === "random" ? "bg-black text-white" : ""}`}
                          onClick={() =>
                            patchSettings(ch.userChallengeId, {
                              envelopes: {
                                cadence: (envelopes.cadence ?? "daily") as "daily" | "weekly",
                                order: "random",
                                maxDrawsPerDay: (envelopes.maxDrawsPerDay ?? 1) as 1 | 2,
                              },
                            })
                          }
                        >
                          Random
                        </button>
                      )}
                      {allowedOrder.includes("reverse") && (
                        <button
                          className={`rounded border px-3 py-1 text-xs ${(envelopes.order ?? "random") === "reverse" ? "bg-black text-white" : ""}`}
                          onClick={() =>
                            patchSettings(ch.userChallengeId, {
                              envelopes: {
                                cadence: (envelopes.cadence ?? "daily") as "daily" | "weekly",
                                order: "reverse",
                                maxDrawsPerDay: (envelopes.maxDrawsPerDay ?? 1) as 1 | 2,
                              },
                            })
                          }
                        >
                          Reverse
                        </button>
                      )}
                      {drawOptions.map((n) => (
                        <button
                          key={n}
                          className={`rounded border px-3 py-1 text-xs ${(envelopes.maxDrawsPerDay ?? 1) === n ? "bg-black text-white" : ""}`}
                          onClick={() =>
                            patchSettings(ch.userChallengeId, {
                              envelopes: {
                                cadence: (envelopes.cadence ?? "daily") as "daily" | "weekly",
                                order: (envelopes.order ?? "random") as "random" | "reverse",
                                maxDrawsPerDay: n,
                              },
                            })
                          }
                        >
                          {n}/day
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          );
        })}
      </section>
    </main>
  );
}
