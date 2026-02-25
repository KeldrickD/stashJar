"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { StashCard } from "@/components/StashCard";
import { StashCardHeader } from "@/components/StashCardHeader";
import { TodayBadge } from "@/components/Badges";

type Card = {
  type: "weather_wednesday";
  challengeId: string;
  eventId: string;
  title: string;
  prompt: string;
  unit: "F" | "C";
  maxAmountCents: number;
  choices?: Array<{ choice: string; amountCents: number }>;
};

type Props = {
  userId?: string;
  card: Card;
  onDone: () => void;
};

export function WeatherWednesdayCard({ card, onDone }: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const choiceButtons = useMemo(() => card.choices ?? [], [card.choices]);

  async function useGps() {
    setErr(null);
    setMsg(null);

    if (!navigator.geolocation) {
      setErr("Location not supported. Enter temperature manually.");
      return;
    }

    setBusy(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 8000,
          maximumAge: 60_000,
        }),
      );

      const lat = Number(pos.coords.latitude.toFixed(2));
      const lon = Number(pos.coords.longitude.toFixed(2));

      const res = await api.setTemperature(card.challengeId, card.eventId, {
        mode: "gps",
        lat,
        lon,
        unit: card.unit,
      });

      if (res?.status === "already_committed") {
        setMsg("Already saved for today ✅");
      } else {
        setMsg("Saved based on today’s temperature ✅");
      }
      onDone();
    } catch (e: unknown) {
      setErr(normalizeErr(e));
    } finally {
      setBusy(false);
    }
  }

  async function chooseWeather(choice: string) {
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      const res = await api.setWeatherChoice(card.challengeId, card.eventId, choice);
      if (res?.status === "already_committed") setMsg("Already saved for today ✅");
      else setMsg(`Saved ✅ (${choice})`);
      onDone();
    } catch (e: unknown) {
      setErr(normalizeErr(e));
    } finally {
      setBusy(false);
    }
  }

  async function manualTemp(temp: number) {
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      const res = await api.setTemperature(card.challengeId, card.eventId, {
        mode: "manual",
        temp,
        unit: card.unit,
      });
      if (res?.status === "already_committed") setMsg("Already saved for today ✅");
      else setMsg("Saved ✅");
      onDone();
    } catch (e: unknown) {
      setErr(normalizeErr(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <StashCard variant="soft" className="sj-appear">
      <StashCardHeader
        icon="🌦️"
        title={card.title}
        subtitle={card.prompt}
        badge={<TodayBadge />}
      />

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          disabled={busy}
          onClick={useGps}
          className="sj-btn sj-btn-primary px-4 py-2 text-sm"
        >
          Use today’s temperature
        </button>

        {choiceButtons.map((c) => (
          <button
            key={c.choice}
            disabled={busy}
            onClick={() => chooseWeather(c.choice)}
            className="sj-btn sj-btn-secondary px-4 py-2 text-sm"
          >
            {c.choice}
          </button>
        ))}

        <ManualTempInline disabled={busy} unit={card.unit} onSubmit={manualTemp} />
      </div>

      {msg && <div className="text-sm mt-2">{msg}</div>}
      {err && <div className="text-sm text-red-600 mt-2">{err}</div>}
    </StashCard>
  );
}

function ManualTempInline({
  disabled,
  unit,
  onSubmit,
}: {
  disabled: boolean;
  unit: "F" | "C";
  onSubmit: (temp: number) => void;
}) {
  const [val, setVal] = useState("");

  return (
      <div className="flex items-center gap-2">
      <input
        disabled={disabled}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder={`Temp (${unit})`}
        inputMode="numeric"
        className="sj-input w-28"
      />
      <button
        disabled={disabled}
        onClick={() => {
          const n = Number(val);
          if (!Number.isFinite(n)) return;
          onSubmit(n);
        }}
        className="sj-btn sj-btn-secondary px-3 py-2 text-sm"
      >
        Save
      </button>
    </div>
  );
}

function normalizeErr(e: unknown) {
  const msg = e instanceof Error ? e.message : "Something went wrong";
  return typeof msg === "string" ? msg : "Something went wrong";
}
