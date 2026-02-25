"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";

function sanitizeReturnTo(value: string | null): string {
  if (!value || typeof value !== "string") return "/";
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.includes("//")) return "/";
  return trimmed;
}

function AuthSuccessContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = sanitizeReturnTo(searchParams.get("returnTo"));

  useEffect(() => {
    void api.trackEvent({
      event: "auth_success",
      metadata: { returnTo },
    }).catch(() => undefined);
    const t = setTimeout(() => router.replace(returnTo), 800);
    return () => clearTimeout(t);
  }, [router, returnTo]);

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="mx-auto max-w-md sj-card-soft p-8 text-center space-y-4 sj-appear">
        <p className="text-lg font-semibold">You&apos;re signed in ✅</p>
        <p className="text-sm sj-text-muted">Redirecting...</p>
      </div>
    </main>
  );
}

export default function AuthSuccessPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-md p-6 text-center">Redirecting...</main>}>
      <AuthSuccessContent />
    </Suspense>
  );
}
