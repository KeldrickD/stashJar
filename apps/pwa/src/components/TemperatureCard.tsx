"use client";

import { useState } from "react";
import { api } from "@/lib/api";

type Card = {
  type: "temperature_daily";
  challengeId: string;
  userChallengeId: string;
  eventId: string;
  title: string;
  prompt: string;
  unit: "F" | "C";
  maxAmountCents: number;
  scale?: 1 | 10;
  availableScales?: Array<1 | 10>;
};

type Props = {
  userId?: string;
  card: Card;
  onDone: () => void;
};

export function TemperatureCard({ card, onDone }: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [scale, setScale] = useState<1 | 10>(card.scale ?? 1);
  const [tempInput, setTempInput] = useState("");

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
    <section className="rounded-xl border p-5 space-y-3">
      <div className="text-lg font-semibold">{card.title}</div>
      <div className="text-sm opacity-70">{card.prompt}</div>

      <div className="flex flex-wrap gap-2">
        {(card.availableScales ?? [1, 10]).map((s) => (
          <button
            key={s}
            disabled={busy}
            onClick={() => updateScale(s)}
            className={`rounded border px-4 py-2 ${scale === s ? "bg-black text-white" : ""}`}
          >
            {s === 1 ? "Classic (Temp = Dollars)" : "Lite (Temp/10)"}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          disabled={busy}
          onClick={useGps}
          className="rounded border px-4 py-2"
        >
          Use today’s temperature
        </button>

        <ManualTempInline
          disabled={busy}
          unit={card.unit}
          value={tempInput}
          onChange={setTempInput}
          onSubmit={manualTemp}
        />
      </div>

      {tempInput && (
        <div className="text-sm opacity-70">
          {previewText(tempInput, scale, card.maxAmountCents)}
        </div>
      )}

      {msg && <div className="text-sm">{msg}</div>}
      {err && <div className="text-sm text-red-600">{err}</div>}
    </section>
  );

  async function updateScale(next: 1 | 10) {
    if (scale === next) return;
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      await api.updateChallengeSettings(
        getUserIdSafe(),
        card.userChallengeId,
        { scaleOverride: next },
      );
      setScale(next);
      setMsg(next === 1 ? "Classic scale enabled" : "Lite scale enabled");
    } catch (e: unknown) {
      setErr(normalizeErr(e));
    } finally {
      setBusy(false);
    }
  }
}

function ManualTempInline({
  disabled,
  unit,
  value,
  onChange,
  onSubmit,
}: {
  disabled: boolean;
  unit: "F" | "C";
  value: string;
  onChange: (v: string) => void;
  onSubmit: (temp: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Temp (${unit})`}
        inputMode="numeric"
        className="border rounded px-3 py-2 w-28"
      />
      <button
        disabled={disabled}
        onClick={() => {
          const n = Number(value);
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

function normalizeErr(e: unknown) {
  const msg = e instanceof Error ? e.message : "Something went wrong";
  return typeof msg === "string" ? msg : "Something went wrong";
}

function previewText(raw: string, scale: number, maxAmountCents: number) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return "Enter a valid temperature.";
  const dollars = Math.round(n / (scale > 0 ? scale : 1));
  const cents = dollars * 100;
  if (cents > maxAmountCents) {
    return `You’ll save $${(maxAmountCents / 100).toFixed(0)} (capped).`;
  }
  return `You’ll save $${dollars.toFixed(0)}.`;
}

function getUserIdSafe() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("stashjar_user_id") ?? "";
}
