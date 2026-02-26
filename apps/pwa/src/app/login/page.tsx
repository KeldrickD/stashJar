"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/");
  }, [router]);
  return (
    <main className="mx-auto max-w-xl p-6">
      <p className="text-sm sj-text-muted">Redirecting…</p>
    </main>
  );
}
