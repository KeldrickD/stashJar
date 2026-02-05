"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { api } from "@/lib/api";
import { getUserId, setUserId as saveUserId } from "@/lib/session";

export default function ChallengesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [userId, setUserId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [activeChallengeId, setActiveChallengeId] = useState<string>("");
  const [loadingUser, setLoadingUser] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setLoadingUser(true);
        const me = await api.getMe();
        const uid = me.userId;
        saveUserId(uid);
        setUserId(uid);
        setError(null);
      } catch (e: any) {
        if (e?.message === "unauthorized") {
          const returnTo = pathname ? encodeURIComponent(pathname) : "";
          router.replace(returnTo ? `/login?returnTo=${returnTo}` : "/login");
          return;
        }
        setError(e?.message ?? "Failed to initialize user");
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
      setActiveChallengeId(res.userChallengeId);
      setStatus(`Started: ${res.userChallengeId}`);
      if (res.primedEventId) {
        localStorage.setItem("focusEventId", res.primedEventId);
      }
      router.push("/");
    } catch (e: any) {
      setStatus(`Error: ${e?.message ?? "Failed to start challenge"}`);
    }
  }

  async function runDue() {
    if (!userId) return;
    try {
      setStatus("Running due challenges…");
      await api.runDueChallenges(userId);
      setStatus("Done.");
    } catch (e: any) {
      setStatus(`Error: ${e?.message ?? "Failed to run due challenges"}`);
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
    } catch (e: any) {
      setStatus(`Error: ${e?.message ?? "Failed to draw envelope"}`);
    }
  }

  async function roll() {
    if (!activeChallengeId) return;
    try {
      const r = await api.rollDice(activeChallengeId);
      setStatus(`Rolled: ${r.roll ?? "?"} (+$${(r.amountCents / 100).toFixed(2)})`);
    } catch (e: any) {
      setStatus(`Error: ${e?.message ?? "Failed to roll dice"}`);
    }
  }

  return (
    <main className="mx-auto max-w-xl p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Challenges</h1>
        <a className="underline text-sm opacity-70" href="/">
          ← Back
        </a>
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
    </main>
  );
}
