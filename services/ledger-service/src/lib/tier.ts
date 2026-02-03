export type Tier = "NORMIE" | "CURIOUS" | "POWER" | "DEV";

type Flags = {
  showCryptoLabels: boolean;
  showTxHistory: boolean;
  showVaultShares: boolean;
  showChainName: boolean;
  showYieldSource: boolean;
  enableOnchainWithdrawToWallet: boolean;
  enableMultiAssetStaking: boolean;
  enableAdvancedAssets: string[];
  enableChallengesV2: boolean;
  enableAutoChallenges: boolean;
  enableStreakBoosts: boolean;
  enableReferralRewards: boolean;
};

export function resolveFlags(tier: Tier, userFlags: any = {}): Flags {
  const base: Flags = {
    showCryptoLabels: false,
    showTxHistory: false,
    showVaultShares: false,
    showChainName: false,
    showYieldSource: false,
    enableOnchainWithdrawToWallet: false,
    enableMultiAssetStaking: false,
    enableAdvancedAssets: [],
    enableChallengesV2: true,
    enableAutoChallenges: true,
    enableStreakBoosts: true,
    enableReferralRewards: false,
  };

  if (tier === "CURIOUS") {
    Object.assign(base, {
      showTxHistory: true,
      showVaultShares: false,
      showCryptoLabels: false,
    });
  }

  if (tier === "POWER") {
    Object.assign(base, {
      showTxHistory: true,
      showVaultShares: true,
      showChainName: true,
      showYieldSource: true,
      enableOnchainWithdrawToWallet: true,
      enableMultiAssetStaking: true,
      enableAdvancedAssets: ["USDC", "cbETH", "WETH"],
    });
  }

  if (tier === "DEV") {
    Object.assign(base, {
      showCryptoLabels: true,
      showTxHistory: true,
      showVaultShares: true,
      showChainName: true,
      showYieldSource: true,
      enableOnchainWithdrawToWallet: true,
      enableMultiAssetStaking: true,
      enableAdvancedAssets: ["USDC", "cbETH", "WETH", "DEGEN"],
      enableReferralRewards: true,
    });
  }

  return { ...base, ...(userFlags || {}) };
}
