"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { EnvelopesTodayCard, FeatureActions } from "@/lib/api";

type Props = {
  userId: string;
  card: EnvelopesTodayCard;
  actions: FeatureActions;
  onDone: () => void | Promise<void>;
};

export function EnvelopesCard({ userId, card, actions, onDone }: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cadence, setCadence] = useState<"daily" | "weekly">(card.cadence ?? "daily");
  const [order, setOrder] = useState<"random" | "reverse">(card.order ?? "random");
  const [maxDrawsPerDay, setMaxDrawsPerDay] = useState<1 | 2>((card.maxDrawsPerDay ?? 1) >= 2 ? 2 : 1);

  const total = card.max - card.min + 1;
  const complete = card.usedCount;
  const pct = total > 0 ? Math.round((complete / total) * 100) : 0;
  const canConfigure =
    actions.canEnvelopesTwoPerDay || actions.canEnvelopesWeeklyCadence || actions.canEnvelopesReverseOrder;

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

  async function saveSettings() {
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      await api.updateChallengeSettings(userId, card.userChallengeId, {
        envelopes: {
          cadence,
          order,
          maxDrawsPerDay,
        },
      });
      setMsg("Envelope settings saved ✅");
      await onDone();
    } catch (e: any) {
      setErr(e?.message ?? "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border p-5 space-y-3">
      <div className="text-lg font-semibold">{card.title}</div>
      <div className="text-sm opacity-70">{card.prompt}</div>

      <div className="flex flex-wrap gap-2 text-xs opacity-70">
        {actions.canEnvelopesTwoPerDay && (
          <span className="rounded border px-2 py-1">
            Max draws/day: {card.maxDrawsPerDay ?? 1}
          </span>
        )}
        {actions.canEnvelopesWeeklyCadence && card.cadence && (
          <span className="rounded border px-2 py-1">
            Cadence: {card.cadence}
          </span>
        )}
        {actions.canEnvelopesReverseOrder && card.order && (
          <span className="rounded border px-2 py-1">
            Order: {card.order}
          </span>
        )}
      </div>

      {canConfigure && (
        <div className="space-y-2 rounded border p-3">
          <div className="text-xs font-medium opacity-70">Settings</div>
          <div className="flex flex-wrap gap-2">
            {actions.canEnvelopesWeeklyCadence && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setCadence("daily")}
                  className={`rounded border px-3 py-1.5 text-xs ${cadence === "daily" ? "bg-black text-white" : ""}`}
                >
                  Daily
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setCadence("weekly")}
                  className={`rounded border px-3 py-1.5 text-xs ${cadence === "weekly" ? "bg-black text-white" : ""}`}
                >
                  Weekly
                </button>
              </>
            )}
            {actions.canEnvelopesReverseOrder && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setOrder("random")}
                  className={`rounded border px-3 py-1.5 text-xs ${order === "random" ? "bg-black text-white" : ""}`}
                >
                  Random
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setOrder("reverse")}
                  className={`rounded border px-3 py-1.5 text-xs ${order === "reverse" ? "bg-black text-white" : ""}`}
                >
                  Reverse
                </button>
              </>
            )}
            {actions.canEnvelopesTwoPerDay && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setMaxDrawsPerDay(1)}
                  className={`rounded border px-3 py-1.5 text-xs ${maxDrawsPerDay === 1 ? "bg-black text-white" : ""}`}
                >
                  1/day
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setMaxDrawsPerDay(2)}
                  className={`rounded border px-3 py-1.5 text-xs ${maxDrawsPerDay === 2 ? "bg-black text-white" : ""}`}
                >
                  2/day
                </button>
              </>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={saveSettings}
              className="rounded border px-3 py-1.5 text-xs font-medium"
            >
              Save
            </button>
          </div>
        </div>
      )}

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
