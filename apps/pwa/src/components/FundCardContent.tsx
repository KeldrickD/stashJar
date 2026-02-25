"use client";

import { FundCard } from "@coinbase/onchainkit/fund";
import type { ComponentType } from "react";

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
    <FundCardCompat
      sessionToken={sessionToken}
      assetSymbol="USDC"
      country="US"
      currency="USD"
      headerText="Add money"
      buttonText="Add money"
    />
  );
}
