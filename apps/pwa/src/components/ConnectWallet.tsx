"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";
import { StashActionGroup } from "./StashActionGroup";

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

function getEthereum(): EthereumProvider | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { ethereum?: EthereumProvider }).ethereum;
}

type Props = {
  returnTo?: string | null;
  onError?: (message: string) => void;
};

export function ConnectWallet({ returnTo, onError }: Props) {
  const pathname = usePathname();
  const [loading, setLoading] = useState(false);

  const returnPath = returnTo ?? (pathname && pathname !== "/" ? pathname : null);

  async function handleConnect() {
    const ethereum = getEthereum();
    if (!ethereum) {
      onError?.("No wallet found. Install Coinbase Wallet or MetaMask.");
      return;
    }
    setLoading(true);
    try {
      const accounts = (await ethereum.request({
        method: "eth_requestAccounts",
        params: [],
      })) as string[];
      const address = accounts?.[0];
      if (!address || typeof address !== "string") {
        onError?.("Could not get wallet address.");
        return;
      }

      const nonceRes = await api.walletAuthNonce(address, returnPath);
      const message = nonceRes.message;

      const signature = (await ethereum.request({
        method: "personal_sign",
        params: [message, address],
      })) as string;

      const verifyRes = await api.walletAuthVerify(address, message, signature, returnPath);
      const path = verifyRes.returnTo && verifyRes.returnTo.startsWith("/") ? verifyRes.returnTo : "/";
      const redirectUrl = path.startsWith("http") ? path : `${window.location.origin}${path}`;
      try {
        (window.top || window).location.href = redirectUrl;
      } catch {
        window.location.href = redirectUrl;
      }
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Connect failed.";
      const s = String(msg).toLowerCase();
      const is404405 =
        s.includes("404") ||
        s.includes("405") ||
        s.includes("method not allowed") ||
        s.includes("not found") ||
        s.includes("failed to fetch");
      const toShow = is404405
        ? "Backend unreachable or method not allowed. Check NEXT_PUBLIC_API_BASE and that the API allows POST (no proxy blocking)."
        : msg.length > 80
          ? "Backend error. Check that NEXT_PUBLIC_API_BASE is set and the API is running."
          : msg;
      onError?.(toShow);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <StashActionGroup
        variant="stack"
        loading={loading}
        primary={{
          label: "Connect wallet",
          onClick: handleConnect,
          disabled: loading,
        }}
        helperText="Use your Coinbase Wallet or MetaMask to sign in."
      />
    </div>
  );
}
