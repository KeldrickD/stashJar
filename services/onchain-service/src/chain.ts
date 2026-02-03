import "dotenv/config";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const RPC_URL = process.env.RPC_URL!;
export const CHAIN_ID = Number(process.env.CHAIN_ID || "31337");
export const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`;

export const account = privateKeyToAccount(PRIVATE_KEY);

export const publicClient = createPublicClient({
  transport: http(RPC_URL),
  chain: {
    id: CHAIN_ID,
    name: process.env.CHAIN || "custom",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  },
});

export const walletClient = createWalletClient({
  account,
  transport: http(RPC_URL),
  chain: {
    id: CHAIN_ID,
    name: process.env.CHAIN || "custom",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  },
});
