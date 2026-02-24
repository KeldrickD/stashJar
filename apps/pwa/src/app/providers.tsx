"use client";

import { OnchainKitProvider } from "@coinbase/onchainkit";
import type { ReactNode } from "react";
import { base } from "viem/chains";
import { SwNavigateListener } from "@/components/SwNavigateListener";

const apiKey = process.env.NEXT_PUBLIC_ONCHAINKIT_API_KEY ?? "";
const projectId = process.env.NEXT_PUBLIC_CDP_PROJECT_ID ?? "";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <OnchainKitProvider
      apiKey={apiKey}
      chain={base}
      projectId={projectId || undefined}
    >
      <SwNavigateListener />
      {children}
    </OnchainKitProvider>
  );
}
