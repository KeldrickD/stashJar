"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";

function sanitizeReturnTo(value: string | null): string | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.includes("//")) return null;
  return trimmed;
}

function LoginContent() {
  const searchParams = useSearchParams();
  const returnTo = sanitizeReturnTo(searchParams.get("returnTo"));
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    setError(null);
    setLoading(true);
    try {
      await api.startAuth(trimmed, returnTo);
      setSent(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-md p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Sign in</h1>
        <p className="text-sm opacity-80 mt-1">
          We&apos;ll email you a sign-in link. No password.
        </p>
      </header>

      {!sent ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full border rounded-lg px-3 py-2"
              autoComplete="email"
              required
              disabled={loading}
            />
          </div>
          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-black text-white py-2 font-medium disabled:opacity-60"
          >
            {loading ? "Sending…" : "Send link"}
          </button>
        </form>
      ) : (
        <p className="text-sm opacity-90">
          Check your email for the sign-in link.
        </p>
      )}
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-md p-6">Loading…</main>}>
      <LoginContent />
    </Suspense>
  );
}
