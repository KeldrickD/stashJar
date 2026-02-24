"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function PushReminderToggle() {
  const [status, setStatus] = useState<{ enabled: boolean; subscriptionCount: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshStatus() {
    try {
      const s = await api.getPushStatus();
      setStatus(s);
      setError(null);
    } catch {
      setStatus(null);
    }
  }

  useEffect(() => {
    refreshStatus();
  }, []);

  async function enableReminders() {
    setLoading(true);
    setError(null);
    try {
      if (!("Notification" in window)) throw new Error("Notifications not supported");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setError("Permission denied");
        setLoading(false);
        return;
      }
      const vapidPublicKey = await api.getVapidPublicKey();
      let reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        await navigator.serviceWorker.ready;
      }
      const sub = await reg!.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
      const endpoint = sub.endpoint;
      const p256dh = arrayBufferToBase64(sub.getKey("p256dh")!);
      const auth = arrayBufferToBase64(sub.getKey("auth")!);
      await api.pushSubscribe({ endpoint, keys: { p256dh, auth } });
      await refreshStatus();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to enable reminders");
    } finally {
      setLoading(false);
    }
  }

  async function disableReminders() {
    setLoading(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await sub.unsubscribe();
          await api.pushUnsubscribe(sub.endpoint);
        }
      }
      await refreshStatus();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to disable");
    } finally {
      setLoading(false);
    }
  }

  if (status === null) return null;

  return (
    <section className="rounded-xl border p-5 space-y-3">
      <h2 className="text-lg font-semibold">Reminders</h2>
      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      {status.subscriptionCount > 0 ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm opacity-80">Reminders are on for this device.</p>
          <button
            type="button"
            onClick={disableReminders}
            disabled={loading}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium disabled:opacity-60"
          >
            {loading ? "…" : "Disable reminders"}
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm opacity-80">Get a nudge when you haven’t saved yet.</p>
          <button
            type="button"
            onClick={enableReminders}
            disabled={loading || !status.enabled}
            className="rounded-lg bg-black text-white px-3 py-1.5 text-sm font-medium disabled:opacity-60"
          >
            {loading ? "…" : status.enabled ? "Enable reminders" : "Reminders unavailable"}
          </button>
        </div>
      )}
    </section>
  );
}
