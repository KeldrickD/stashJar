"use client";

import { useState } from "react";
import { api } from "@/lib/api";

type Card = {
  type: "dice_daily";
  challengeId: string;
  eventId: string;
  title: string;
  prompt: string;
  sides: number;
  unitAmountCents: number;
  multiDice?: number;
  multiplier?: number;
};

type Props = {
  userId?: string;
  card: Card;
  onDone: () => void;
};

export function DiceCard({ card, onDone }: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function roll() {
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      const res = await api.rollDiceEvent(card.challengeId, card.eventId);
      if (res?.status === "already_committed") {
        setMsg("Already saved for today ✅");
      } else {
        const dollars = (res.amountCents ?? 0) / 100;
        const rollLabel = Array.isArray(res.rollBreakdown)
          ? `${res.rollBreakdown.join(" + ")} = ${res.roll}`
          : res.multiplier
            ? `${res.roll} × ${res.multiplier}`
            : String(res.roll);
        setMsg(`You rolled ${rollLabel} — saving $${dollars.toFixed(0)} ✅`);
      }
      onDone();
    } catch (e: any) {
      setErr(normalizeErr(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border p-5 space-y-3">
      <div className="text-lg font-semibold">{card.title}</div>
      <div className="text-sm opacity-70">
        {card.prompt}
        {(card.multiDice === 2 || card.multiplier === 10 || (card.sides !== 6 && card.sides > 0)) && (
          <span className="ml-1 text-xs opacity-60">
            {card.multiplier === 10 ? " ×10" : card.multiDice === 2 ? " 2×D" + card.sides : " D" + card.sides}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          disabled={busy}
          onClick={roll}
          className="rounded border px-4 py-2"
        >
          Roll
        </button>
      </div>

      {msg && <div className="text-sm">{msg}</div>}
      {err && <div className="text-sm text-red-600">{err}</div>}
    </section>
  );
}

function normalizeErr(e: any) {
  const msg = e?.message ?? "Something went wrong";
  return typeof msg === "string" ? msg : "Something went wrong";
}
