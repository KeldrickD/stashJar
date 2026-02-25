"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { EnvelopesTodayCard, FeatureActions } from "@/lib/api";
import { StashCard } from "@/components/StashCard";
import { StashCardHeader } from "@/components/StashCardHeader";
import { PowerBadge, TodayBadge } from "@/components/Badges";
import { StashActionGroup } from "@/components/StashActionGroup";
import { StashStatusLine } from "@/components/StashStatusLine";

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
      if (res?.done) {
        setMsg("Challenge complete! 🎉");
      } else {
        const envelope = res.envelope ?? 0;
        const amountCents = res.amountCents ?? 0;
        const dollars = amountCents / 100;
        setMsg(`Envelope ${envelope} → saving $${dollars.toFixed(0)} ✅`);
      }
      onDone();
    } catch (e: unknown) {
      let data: { error?: string } | null = null;
      try {
        const msg = e instanceof Error ? e.message : "";
        data = typeof msg === "string" ? (JSON.parse(msg) as { error?: string }) : null;
      } catch {
        data = null;
      }
      const dailyLimit =
        typeof data === "object" && data?.error === "daily_limit";
      setErr(
        dailyLimit ? "Come back tomorrow." : (e instanceof Error ? e.message : "Something went wrong"),
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
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <StashCard variant="soft" className="sj-appear">
      <StashCardHeader
        icon="✉️"
        title={card.title}
        subtitle={card.prompt}
        badge={<TodayBadge />}
        right={canConfigure ? <PowerBadge /> : null}
      />

      <div className="mt-4 flex flex-wrap gap-2 text-xs sj-text-muted">
        {actions.canEnvelopesTwoPerDay && (
          <span className="sj-badge sj-badge-brand">
            Max draws/day: {card.maxDrawsPerDay ?? 1}
          </span>
        )}
        {actions.canEnvelopesWeeklyCadence && card.cadence && (
          <span className="sj-badge sj-badge-brand">
            Cadence: {card.cadence}
          </span>
        )}
        {actions.canEnvelopesReverseOrder && card.order && (
          <span className="sj-badge sj-badge-brand">
            Order: {card.order}
          </span>
        )}
      </div>

      {canConfigure && (
        <div className="sj-panel mt-4 space-y-2">
          <div className="text-xs font-medium sj-text-muted">Settings</div>
          <div className="flex flex-wrap gap-2">
            {actions.canEnvelopesWeeklyCadence && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setCadence("daily")}
                  className={`sj-toggle-btn ${cadence === "daily" ? "sj-toggle-btn-active" : ""}`}
                >
                  Daily
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setCadence("weekly")}
                  className={`sj-toggle-btn ${cadence === "weekly" ? "sj-toggle-btn-active" : ""}`}
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
                  className={`sj-toggle-btn ${order === "random" ? "sj-toggle-btn-active" : ""}`}
                >
                  Random
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setOrder("reverse")}
                  className={`sj-toggle-btn ${order === "reverse" ? "sj-toggle-btn-active" : ""}`}
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
                  className={`sj-toggle-btn ${maxDrawsPerDay === 1 ? "sj-toggle-btn-active" : ""}`}
                >
                  1/day
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setMaxDrawsPerDay(2)}
                  className={`sj-toggle-btn ${maxDrawsPerDay === 2 ? "sj-toggle-btn-active" : ""}`}
                >
                  2/day
                </button>
              </>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={saveSettings}
              className="sj-btn sj-btn-secondary px-3 py-1.5 text-xs font-medium"
            >
              Save
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <div className="sj-progress-track">
          <div className="sj-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-sm tabular-nums">
          {complete}/{total}
        </span>
      </div>

      {card.drewToday ? (
        <StashStatusLine tone="success" text="Already drew today ✅ Come back tomorrow." />
      ) : (
        <StashActionGroup
          variant="stack"
          loading={busy}
          primary={{
            label: "Draw now",
            onClick: () => {
              void draw();
            },
            disabled: busy || card.remainingCount === 0,
          }}
        />
      )}

      {msg && <StashStatusLine tone="success" text={msg} compact />}
      {err && <StashStatusLine tone="warning" text={err} compact />}
    </StashCard>
  );
}
