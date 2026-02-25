"use client";

import { OnchainKitProvider } from "@coinbase/onchainkit";
import { FundCard } from "@coinbase/onchainkit/fund";
import type { ComponentType } from "react";
import { base } from "viem/chains";

const apiKey = process.env.NEXT_PUBLIC_ONCHAINKIT_API_KEY ?? "";
const projectId = process.env.NEXT_PUBLIC_CDP_PROJECT_ID ?? "";

const FundCardCompat = FundCard as unknown as ComponentType<{
  sessionToken: string;
  assetSymbol: string;
  country: string;
  currency: string;
  headerText: string;
  buttonText: string;
}>;

type Props = {
  sessionToken: string;
};

export function FundCardContent({ sessionToken }: Props) {
  return (
    <OnchainKitProvider
      apiKey={apiKey}
      chain={base}
      projectId={projectId || undefined}
    >
      <FundCardCompat
        sessionToken={sessionToken}
        assetSymbol="USDC"
        country="US"
        currency="USD"
        headerText="Add money"
        buttonText="Add money"
      />
    </OnchainKitProvider>
  );
}
