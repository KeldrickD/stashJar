"use client";

import { OnchainKitProvider } from "@coinbase/onchainkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";
import { Attribution } from "ox/erc8021";
import { base } from "viem/chains";
import { WagmiProvider, createConfig, http } from "wagmi";
import { coinbaseWallet } from "wagmi/connectors";
import { SwNavigateListener } from "@/components/SwNavigateListener";

const apiKey = process.env.NEXT_PUBLIC_ONCHAINKIT_API_KEY ?? "";
const projectId = process.env.NEXT_PUBLIC_CDP_PROJECT_ID ?? "";

const DATA_SUFFIX = Attribution.toDataSuffix({
  codes: ["bc_rzvmpvcl"],
});

function getConfig() {
  return createConfig({
    chains: [base],
    connectors: [
      coinbaseWallet({
        appName: "StashJar",
        preference: { options: "smartWalletOnly" },
      }),
    ],
    transports: {
      [base.id]: http(),
    },
    dataSuffix: DATA_SUFFIX,
  });
}

export function Providers({ children }: { children: ReactNode }) {
  const [config] = useState(() => getConfig());
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <OnchainKitProvider apiKey={apiKey} chain={base} projectId={projectId || undefined}>
          <SwNavigateListener />
          {children}
        </OnchainKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
