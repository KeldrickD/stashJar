"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api";

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
    } catch (e: any) {
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
    } catch (e: any) {
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
    } catch (e: any) {
      setErr(normalizeErr(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border p-5 space-y-3">
      <div className="text-lg font-semibold">{card.title}</div>
      <div className="text-sm opacity-70">{card.prompt}</div>

      <div className="flex flex-wrap gap-2">
        <button
          disabled={busy}
          onClick={useGps}
          className="rounded border px-4 py-2"
        >
          Use today’s temperature
        </button>

        {choiceButtons.map((c) => (
          <button
            key={c.choice}
            disabled={busy}
            onClick={() => chooseWeather(c.choice)}
            className="rounded border px-4 py-2"
          >
            {c.choice}
          </button>
        ))}

        <ManualTempInline disabled={busy} unit={card.unit} onSubmit={manualTemp} />
      </div>

      {msg && <div className="text-sm">{msg}</div>}
      {err && <div className="text-sm text-red-600">{err}</div>}
    </section>
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
        className="border rounded px-3 py-2 w-28"
      />
      <button
        disabled={disabled}
        onClick={() => {
          const n = Number(val);
          if (!Number.isFinite(n)) return;
          onSubmit(n);
        }}
        className="rounded border px-3 py-2"
      >
        Save
      </button>
    </div>
  );
}

function normalizeErr(e: any) {
  const msg = e?.message ?? "Something went wrong";
  return typeof msg === "string" ? msg : "Something went wrong";
}
