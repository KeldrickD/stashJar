"use client";

import { useState } from "react";
import { api, TodayBanner } from "@/lib/api";

type Props = {
  userId: string;
  banner: TodayBanner;
  onDone: () => void;
};

export function ApplyMissedSavesBanner({ userId, banner, onDone }: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (banner.type === "needs_input") {
    return (
      <section className="rounded-xl border p-5 space-y-2">
        <div className="text-lg font-semibold">{banner.label}</div>
        <div className="text-sm opacity-70">{banner.subLabel}</div>
        <div className="text-sm opacity-70">Pending: {banner.pendingCount}</div>
      </section>
    );
  }

  if (banner.type !== "commit_pending") return null;

  async function applyNow() {
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      const res = await api.commitPending(userId, 200);
      if (res?.committedCents > 0) {
        const dollars = (res.committedCents / 100).toFixed(2);
        if (res?.perRunCapHit || res?.skippedCapCount > 0) {
          setMsg(`Applied $${dollars} ✅ More will apply tomorrow.`);
        } else {
          setMsg(`Applied $${dollars} ✅`);
        }
      } else {
        setMsg("You’re at today’s cap — more will apply tomorrow.");
      }
      onDone();
    } catch (e: any) {
      setErr(normalizeErr(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border p-5 space-y-2">
      <div className="text-lg font-semibold">{banner.label}</div>
      <div className="text-sm opacity-70">{banner.subLabel}</div>
      <div className="text-sm opacity-70">Pending: {banner.pendingCount}</div>
      <div>
        <button
          disabled={busy}
          onClick={applyNow}
          className="rounded border px-4 py-2"
        >
          Apply now
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
