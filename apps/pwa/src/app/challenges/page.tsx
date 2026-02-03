"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { getUserId } from "@/lib/session";

export default function ChallengesPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [activeChallengeId, setActiveChallengeId] = useState<string>("");

  useEffect(() => {
    setUserId(getUserId());
  }, []);

  async function start(slug: string) {
    if (!userId) return;
    setStatus(`Starting ${slug}…`);
    const res = await api.startChallenge(userId, slug);
    setActiveChallengeId(res.userChallengeId);
    setStatus(`Started: ${res.userChallengeId}`);
  }

  async function runDue() {
    setStatus("Running due challenges…");
    await api.runDueChallenges();
    setStatus("Done.");
  }

  async function draw() {
    if (!activeChallengeId) return;
    const r = await api.drawEnvelope(activeChallengeId);
    setStatus(
      `Envelope: ${r.envelope} (+$${(r.amountCents / 100).toFixed(
        2,
      )}), remaining: ${r.remainingCount}`,
    );
  }

  async function roll() {
    if (!activeChallengeId) return;
    const r = await api.rollDice(activeChallengeId);
    setStatus(`Rolled: ${r.roll ?? "?"} (+$${(r.amountCents / 100).toFixed(2)})`);
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
        <div className="flex flex-col gap-2">
          <button className="rounded bg-black text-white px-4 py-2" onClick={() => start("52_week")}>
            Start 52-week
          </button>
          <button className="rounded bg-black text-white px-4 py-2" onClick={() => start("100_envelopes")}>
            Start 100 envelopes
          </button>
          <button className="rounded bg-black text-white px-4 py-2" onClick={() => start("dice")}>
            Start dice
          </button>
        </div>
      </section>

      <section className="rounded-xl border p-5 space-y-2">
        <h2 className="font-semibold">Actions</h2>
        <div className="flex gap-2 flex-wrap">
          <button className="rounded border px-4 py-2" onClick={runDue}>
            Run due (52-week)
          </button>
          <button className="rounded border px-4 py-2" onClick={draw}>
            Draw envelope
          </button>
          <button className="rounded border px-4 py-2" onClick={roll}>
            Roll dice
          </button>
        </div>
        <div className="text-sm opacity-70 break-words">{status}</div>
        <div className="text-xs opacity-60">Active challenge: {activeChallengeId || "none"}</div>
      </section>
    </main>
  );
}
