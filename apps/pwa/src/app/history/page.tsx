"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { api } from "@/lib/api";
import { setUserId } from "@/lib/session";

function fmt(cents: number) {
  const sign = cents >= 0 ? "+": "-";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export default function HistoryPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [items, setItems] = useState<Array<{ occurredAt: string; type: string; amountCents: number; memo?: string }>>([]);
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
      } catch (e: unknown) {
        if (e instanceof Error && e.message === "unauthorized") {
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
    <main className="mx-auto max-w-xl px-4 py-6 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">History</h1>
        <p className="text-sm sj-text-muted">Track every movement in your vault.</p>
        <Link className="sj-link text-sm" href="/">
          ← Back
        </Link>
      </header>

      {status && <div className="text-sm sj-text-muted">{status}</div>}

      <ul className="space-y-2">
        {items.map((t, i) => (
          <li key={i} className="sj-card-solid p-4 sj-lift">
            <div className="flex justify-between">
              <div className="font-semibold">{t.type.replaceAll("_", " ")}</div>
              <div className="font-mono">{fmt(t.amountCents)}</div>
            </div>
            <div className="text-xs sj-text-faint">{new Date(t.occurredAt).toLocaleString()}</div>
            {t.memo && <div className="text-sm sj-text-muted">{t.memo}</div>}
          </li>
        ))}
      </ul>
    </main>
  );
}
