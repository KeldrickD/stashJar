"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { api } from "@/lib/api";
import { getUserId, setUserId } from "@/lib/session";

function fmt(cents: number) {
  const sign = cents >= 0 ? "+": "-";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export default function HistoryPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [items, setItems] = useState<any[]>([]);
  const [status, setStatus] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const me = await api.getMe();
        const uid = me.userId;
        setUserId(uid);
        setStatus("Loading…");
        const res = await api.getTxHistory(uid);
        setItems(res.transactions ?? []);
      } catch (e: any) {
        if (e?.message === "unauthorized") {
          const returnTo = pathname ? encodeURIComponent(pathname) : "";
          router.replace(returnTo ? `/login?returnTo=${returnTo}` : "/login");
          return;
        }
      } finally {
        setStatus("");
      }
    })();
  }, [router, pathname]);

  return (
    <main className="mx-auto max-w-xl p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">History</h1>
        <a className="underline text-sm opacity-70" href="/">
          ← Back
        </a>
      </header>

      {status && <div className="text-sm opacity-70">{status}</div>}

      <ul className="space-y-2">
        {items.map((t, i) => (
          <li key={i} className="rounded-xl border p-4">
            <div className="flex justify-between">
              <div className="font-semibold">{t.type}</div>
              <div className="font-mono">{fmt(t.amountCents)}</div>
            </div>
            <div className="text-xs opacity-60">{new Date(t.occurredAt).toLocaleString()}</div>
            {t.memo && <div className="text-sm opacity-70">{t.memo}</div>}
          </li>
        ))}
      </ul>
    </main>
  );
}
