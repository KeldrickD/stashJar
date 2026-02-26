"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { StashActionGroup } from "@/components/StashActionGroup";

function sanitizeReturnTo(value: string | null): string | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.includes("//")) return null;
  return trimmed;
}

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

/** Prefer window.ethereum; fallback to coinbaseWalletExtension for some in-app browsers. */
function getEthereumProvider(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    ethereum?: Eip1193Provider;
    coinbaseWalletExtension?: Eip1193Provider;
  };
  return w.ethereum ?? w.coinbaseWalletExtension ?? null;
}

/** Resolve provider, optionally waiting for late injection (e.g. in-app browsers). */
function getEthereumProviderWithWait(): Promise<Eip1193Provider | null> {
  const p = getEthereumProvider();
  if (p) return Promise.resolve(p);
  return new Promise((resolve) => {
    const deadline = Date.now() + 1500;
    const check = () => {
      const provider = getEthereumProvider();
      if (provider) {
        resolve(provider);
        return;
      }
      if (Date.now() < deadline) {
        setTimeout(check, 150);
      } else {
        resolve(null);
      }
    };
    setTimeout(check, 150);
  });
}

function getOpenInWalletUrl(): string {
  if (typeof window === "undefined") return "#";
  const url = encodeURIComponent(window.location.href);
  return `https://go.cb-w.com/dapp?url=${url}`;
}

function isMobileUserAgent(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent.toLowerCase();
  return /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua);
}

/** Full URL for redirect; use top frame so we break out of iframes (in-app browsers). */
function redirectTo(path: string): void {
  const base = typeof window !== "undefined" ? window.location.origin : "";
  const target = path.startsWith("http") ? path : `${base}${path.startsWith("/") ? path : `/${path}`}`;
  try {
    if (window.top && window.top !== window) {
      window.top.location.replace(target);
    } else {
      window.location.replace(target);
    }
  } catch {
    window.location.href = target;
  }
}

function LoginContent() {
  const searchParams = useSearchParams();
  const returnTo = sanitizeReturnTo(searchParams.get("returnTo"));
  const context = searchParams.get("context");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletInfo, setWalletInfo] = useState<string | null>(null);
  const [embedded, setEmbedded] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const autoAttemptedRef = useRef(false);
  const miniappMode = useMemo(() => context === "miniapp" || embedded, [context, embedded]);

  useEffect(() => {
    try {
      setEmbedded(window.self !== window.top);
    } catch {
      setEmbedded(true);
    }
    setIsMobile(isMobileUserAgent());
  }, []);

  const signInWithWallet = useCallback(async ({ auto = false }: { auto?: boolean } = {}) => {
    setWalletLoading(true);
    setError(null);
    setWalletInfo(auto ? "Connecting…" : null);

    const provider = await getEthereumProviderWithWait();
    if (!provider) {
      setWalletLoading(false);
      if (!auto) setError("No wallet detected. Use the link below to open in a wallet browser, or sign in with email.");
      setWalletInfo(auto ? "No wallet here. Open in Coinbase Wallet or use email." : null);
      return;
    }

    setWalletInfo(auto ? "Trying wallet sign-in…" : "Connecting…");
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      const address = Array.isArray(accounts) ? String(accounts[0] ?? "") : "";
      if (!address) throw new Error("No wallet account selected.");

      setWalletInfo("Sign the message in your wallet…");
      const nonce = await api.walletAuthNonce(address, returnTo);
      let signature: string;
      try {
        signature = (await provider.request({
          method: "personal_sign",
          params: [nonce.message, address],
        })) as string;
      } catch {
        signature = (await provider.request({
          method: "personal_sign",
          params: [address, nonce.message],
        })) as string;
      }

      setWalletInfo("Signing you in…");
      const verified = await api.walletAuthVerify(address, nonce.message, signature, returnTo);
      const path = sanitizeReturnTo(verified.returnTo) ?? returnTo ?? "/";
      // Short delay so the browser can persist the Set-Cookie from the verify response before we navigate.
      setTimeout(() => redirectTo(path), 150);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Wallet sign-in failed. Try again or use email.";
      if (!auto) setError(message);
      setWalletInfo(auto ? "Use wallet or email below." : null);
    } finally {
      setWalletLoading(false);
    }
  }, [returnTo]);

  useEffect(() => {
    if (!miniappMode || autoAttemptedRef.current) return;
    autoAttemptedRef.current = true;
    void signInWithWallet({ auto: true });
  }, [miniappMode, signInWithWallet]);

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

  const showOpenInWallet = isMobile && !getEthereumProvider();

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
          {miniappMode && (
            <p className="text-xs sj-text-faint">Miniapp mode: wallet sign-in is preferred.</p>
          )}
        </header>

        {!sent ? (
          <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
            <StashActionGroup
              variant="stack"
              loading={walletLoading}
              primary={{
                label: "Sign in with wallet",
                onClick: () => void signInWithWallet(),
                disabled: walletLoading || loading,
              }}
              helperText={walletInfo ?? "Use your wallet to sign in — no password."}
            />
            {showOpenInWallet && (
              <p className="text-xs sj-text-faint">
                No wallet in this browser.{" "}
                <a href={getOpenInWalletUrl()} target="_blank" rel="noopener noreferrer" className="sj-link underline">
                  Open in Coinbase Wallet
                </a>{" "}
                to sign in with your wallet.
              </p>
            )}
            <div className="pt-1">
              <p className="text-xs sj-text-faint">or use email</p>
            </div>
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
                disabled={loading || walletLoading}
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
                onClick: () => formRef.current?.requestSubmit(),
                disabled: loading || walletLoading,
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
