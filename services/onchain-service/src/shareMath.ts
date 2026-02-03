import StashVaultJson from "../../../contracts/stash-vault/artifacts/contracts/StashVault.sol/StashVault.json" assert { type: "json" };

import { Address } from "viem";
import { publicClient } from "./chain";

const vaultAbi = (StashVaultJson as any).abi;

export async function previewRedeem(vault: Address, shares: bigint): Promise<bigint> {
  return (await publicClient.readContract({
    address: vault,
    abi: vaultAbi,
    functionName: "previewRedeem",
    args: [shares],
  })) as bigint;
}

export async function previewDeposit(vault: Address, usdcMicros: bigint): Promise<bigint> {
  return (await publicClient.readContract({
    address: vault,
    abi: vaultAbi,
    functionName: "previewDeposit",
    args: [usdcMicros],
  })) as bigint;
}

/**
 * Find the minimum shares such that previewRedeem(shares) >= targetUsdcMicros.
 * Bounded by the user's maxShares (their current balance).
 */
export async function sharesForExactUsdc(params: {
  vault: Address;
  targetUsdcMicros: bigint;
  maxShares: bigint;
}): Promise<bigint> {
  const { vault, targetUsdcMicros, maxShares } = params;

  if (targetUsdcMicros <= 0n) return 0n;
  if (maxShares <= 0n) throw new Error("no shares available");

  const maxOut = await previewRedeem(vault, maxShares);
  if (maxOut < targetUsdcMicros) {
    throw new Error(`insufficient shares: max redeem ${maxOut} < target ${targetUsdcMicros}`);
  }

  let lo = 1n;
  let hi = maxShares;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const out = await previewRedeem(vault, mid);
    if (out >= targetUsdcMicros) {
      hi = mid;
    } else {
      lo = mid + 1n;
    }
  }

  return lo;
}
