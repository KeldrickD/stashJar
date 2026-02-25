"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { DiceTodayCard, FeatureActions } from "@/lib/api";
import { StashCard } from "@/components/StashCard";
import { StashCardHeader } from "@/components/StashCardHeader";
import { PowerBadge, TodayBadge } from "@/components/Badges";

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
    <StashCard variant="soft" className="sj-appear">
      <StashCardHeader
        icon="🎲"
        title={card.title}
        subtitle={card.prompt}
        badge={<TodayBadge />}
        right={actions.canDiceChooseSides ? <PowerBadge /> : null}
      />

      {(multiDice || multiplier10 || sides !== 6) && (
        <div className="text-xs sj-text-faint mt-2">
          Active mode: {multiplier10 ? "×10" : multiDice ? `2×D${sides}` : `D${sides}`}
        </div>
      )}

      {actions.canDiceChooseSides && (
        <div className="mt-4 flex flex-wrap gap-2">
          {allowedSides.map((opt) => (
            <button
              key={opt}
              type="button"
              disabled={busy}
              onClick={() => setSides(opt)}
              className={`sj-toggle-btn ${
                sides === opt ? "sj-toggle-btn-active" : ""
              }`}
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
            className={`sj-toggle-btn ${
              multiDice ? "sj-toggle-btn-active" : ""
            }`}
          >
            2 dice
          </button>
        )}
        {actions.canDiceMultiplier10 && (
          <button
            type="button"
            disabled={busy || multiDice}
            onClick={() => setMultiplier10((v) => !v)}
            className={`sj-toggle-btn ${
              multiplier10 ? "sj-toggle-btn-active" : ""
            }`}
          >
            ×10
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          disabled={busy}
          onClick={roll}
          className="sj-btn sj-btn-primary px-4 py-2 text-sm"
        >
          Roll today
        </button>
        {canSaveDefaults && (
          <button
            type="button"
            disabled={busy}
            onClick={saveDefaults}
            className="sj-btn sj-btn-secondary px-4 py-2 text-sm"
          >
            Save as default
          </button>
        )}
      </div>

      {msg && <div className="text-sm mt-2">{msg}</div>}
      {err && <div className="text-sm text-red-600 mt-2">{err}</div>}
    </StashCard>
  );
}

function normalizeErr(e: unknown) {
  const msg = e instanceof Error ? e.message : "Something went wrong";
  return typeof msg === "string" ? msg : "Something went wrong";
}
