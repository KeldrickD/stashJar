"use client";

import { Suspense, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { StashActionGroup } from "@/components/StashActionGroup";

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
  const formRef = useRef<HTMLFormElement | null>(null);

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
    <main className="min-h-screen px-4 py-10">
      <div className="mx-auto max-w-md sj-card-soft p-7 sm:p-8 space-y-6">
        <header className="space-y-2">
          <p className="text-xs tracking-[0.18em] uppercase text-emerald-700/80 font-semibold">
            StashJar
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Build your savings habit.</h1>
          <p className="text-sm sj-text-muted">
            Small daily actions. Real money saved. No friction.
          </p>
        </header>

        {!sent ? (
          <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1.5">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="sj-input px-4 py-3 text-sm focus:border-emerald-300 focus:outline-none"
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
            <StashActionGroup
              variant="stack"
              loading={loading}
              primary={{
                label: "Send sign-in link",
                onClick: () => {
                  formRef.current?.requestSubmit();
                },
                disabled: loading,
              }}
              helperText="No password needed."
            />
          </form>
        ) : (
          <p className="text-sm sj-text-muted">
            Check your email for the sign-in link.
          </p>
        )}
      </div>
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
