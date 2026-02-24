"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

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
    const t = setTimeout(() => router.replace(returnTo), 800);
    return () => clearTimeout(t);
  }, [router, returnTo]);

  return (
    <main className="mx-auto max-w-md p-6 text-center space-y-4">
      <p className="text-lg font-medium">You&apos;re signed in ✅</p>
      <p className="text-sm opacity-80">Redirecting…</p>
    </main>
  );
}

export default function AuthSuccessPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-md p-6 text-center">Redirecting…</main>}>
      <AuthSuccessContent />
    </Suspense>
  );
}
