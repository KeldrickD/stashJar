"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { DiceTodayCard, FeatureActions } from "@/lib/api";

type Props = {
  userId: string;
  card: DiceTodayCard;
  actions: FeatureActions;
  onDone: () => void | Promise<void>;
};

export function DiceCard({ userId, card, actions, onDone }: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sides, setSides] = useState<6 | 12 | 20 | 100>((card.sides as 6 | 12 | 20 | 100) ?? 6);
  const [multiDice, setMultiDice] = useState<boolean>(card.multiDice === 2);
  const [multiplier10, setMultiplier10] = useState<boolean>(card.multiplier === 10);

  const allowedSides: Array<6 | 12 | 20 | 100> = actions.canDiceChooseSides ? [6, 12, 20, 100] : [6];
  const canSaveDefaults =
    actions.canDiceChooseSides || actions.canDiceTwoDice || actions.canDiceMultiplier10;

  async function roll() {
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      const res = await api.rollDiceEvent(card.challengeId, card.eventId, {
        sides,
        multiDice: multiDice ? 2 : 1,
        multiplier: multiplier10 ? 10 : 1,
      });
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
    } catch (e: unknown) {
      setErr(normalizeErr(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveDefaults() {
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      await api.updateChallengeSettings(userId, card.userChallengeId, {
        dice: {
          sides,
          multiDice: multiDice ? 2 : 1,
          multiplier: multiplier10 ? 10 : 1,
        },
      });
      setMsg("Dice defaults saved ✅");
      await onDone();
    } catch (e: unknown) {
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
        {(multiDice || multiplier10 || (sides !== 6 && sides > 0)) && (
          <span className="ml-1 text-xs opacity-60">
            {multiplier10 ? " ×10" : multiDice ? " 2×D" + sides : " D" + sides}
          </span>
        )}
      </div>

      {actions.canDiceChooseSides && (
        <div className="flex flex-wrap gap-2">
          {allowedSides.map((opt) => (
            <button
              key={opt}
              type="button"
              disabled={busy}
              onClick={() => setSides(opt)}
              className={`rounded border px-3 py-1.5 text-sm ${sides === opt ? "bg-black text-white" : ""}`}
            >
              D{opt}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {actions.canDiceTwoDice && (
          <button
            type="button"
            disabled={busy || multiplier10}
            onClick={() => setMultiDice((v) => !v)}
            className={`rounded border px-3 py-1.5 text-sm ${multiDice ? "bg-black text-white" : ""}`}
          >
            2 dice
          </button>
        )}
        {actions.canDiceMultiplier10 && (
          <button
            type="button"
            disabled={busy || multiDice}
            onClick={() => setMultiplier10((v) => !v)}
            className={`rounded border px-3 py-1.5 text-sm ${multiplier10 ? "bg-black text-white" : ""}`}
          >
            ×10
          </button>
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
        {canSaveDefaults && (
          <button
            type="button"
            disabled={busy}
            onClick={saveDefaults}
            className="rounded border px-4 py-2"
          >
            Save as default
          </button>
        )}
      </div>

      {msg && <div className="text-sm">{msg}</div>}
      {err && <div className="text-sm text-red-600">{err}</div>}
    </section>
  );
}

function normalizeErr(e: unknown) {
  const msg = e instanceof Error ? e.message : "Something went wrong";
  return typeof msg === "string" ? msg : "Something went wrong";
}
