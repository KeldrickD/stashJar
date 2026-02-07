/**
 * Read-only chain access for funding/refresh: USDC balance of a wallet.
 * Used by POST /users/:id/funding/refresh. Requires RPC_URL and USDC_ADDRESS.
 */
import { createPublicClient, http } from "viem";

const RPC_URL = process.env.RPC_URL?.trim();
const USDC_ADDRESS = process.env.USDC_ADDRESS as `0x${string}` | undefined;
const CHAIN_ID = Number(process.env.CHAIN_ID ?? "8453");

const erc20BalanceOfAbi = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

let client: ReturnType<typeof createPublicClient> | null = null;

function getClient() {
  if (!RPC_URL || !USDC_ADDRESS) return null;
  if (!client) {
    client = createPublicClient({
      transport: http(RPC_URL),
      chain: {
        id: CHAIN_ID,
        name: "base",
        nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [RPC_URL] } },
      },
    });
  }
  return client;
}

export function isFundingConfigured(): boolean {
  return !!(RPC_URL && USDC_ADDRESS);
}

export async function getUsdcBalanceMicros(walletAddress: string): Promise<bigint | null> {
  const c = getClient();
  if (!c) return null;
  try {
    const balance = await c.readContract({
      address: USDC_ADDRESS!,
      abi: erc20BalanceOfAbi,
      functionName: "balanceOf",
      args: [walletAddress as `0x${string}`],
    });
    return typeof balance === "bigint" ? balance : BigInt(String(balance));
  } catch {
    return null;
  }
}
