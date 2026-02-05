"use client";

import { useState } from "react";
import { api } from "@/lib/api";

type Card = {
  type: "envelopes_100";
  challengeId: string;
  userChallengeId: string;
  title: string;
  prompt: string;
  remainingCount: number;
  usedCount: number;
  min: number;
  max: number;
  unitAmountCents: number;
  maxDrawsPerDay?: number;
  drewToday?: boolean;
};

type Props = {
  userId?: string;
  card: Card;
  onDone: () => void;
};

export function EnvelopesCard({ card, onDone }: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const total = card.max - card.min + 1;
  const complete = card.usedCount;
  const pct = total > 0 ? Math.round((complete / total) * 100) : 0;

  async function draw() {
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      const res = await api.drawEnvelope(card.userChallengeId);
      if ((res as any)?.done) {
        setMsg("Challenge complete! 🎉");
      } else {
        const envelope = (res as any).envelope ?? 0;
        const amountCents = (res as any).amountCents ?? 0;
        const dollars = amountCents / 100;
        setMsg(`Envelope ${envelope} → saving $${dollars.toFixed(0)} ✅`);
      }
      onDone();
    } catch (e: any) {
      let data: any = null;
      try {
        data = typeof e?.message === "string" ? JSON.parse(e.message) : null;
      } catch {
        data = null;
      }
      const dailyLimit =
        typeof data === "object" && data?.error === "daily_limit";
      setErr(
        dailyLimit ? "Come back tomorrow." : (e?.message ?? "Something went wrong"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border p-5 space-y-3">
      <div className="text-lg font-semibold">{card.title}</div>
      <div className="text-sm opacity-70">{card.prompt}</div>

      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 rounded-full bg-black/10 overflow-hidden">
          <div
            className="h-full bg-black rounded-full transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-sm tabular-nums">
          {complete}/{total}
        </span>
      </div>

      {card.drewToday ? (
        <div className="text-sm text-green-700">
          Already drew today ✅ Come back tomorrow.
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            disabled={busy || card.remainingCount === 0}
            onClick={draw}
            className="rounded border px-4 py-2 font-medium disabled:opacity-50"
          >
            Draw
          </button>
        </div>
      )}

      {msg && <div className="text-sm">{msg}</div>}
      {err && <div className="text-sm text-red-600">{err}</div>}
    </section>
  );
}
