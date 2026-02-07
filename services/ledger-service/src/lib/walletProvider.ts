import crypto from "node:crypto";

/**
 * Wallet provision abstraction: swap deterministic dev impl for production smart-wallet API.
 */

export type CreateSmartWalletResult = {
  address: string;
  providerRef: string | null;
};

export interface WalletProvider {
  createSmartWallet(userId: string): Promise<CreateSmartWalletResult>;
}

/**
 * Deterministic dev wallet (sha256 prefix). Production: replace with Coinbase SDK or similar.
 */
export const deterministicWalletProvider: WalletProvider = {
  async createSmartWallet(userId: string): Promise<CreateSmartWalletResult> {
    const hash = crypto.createHash("sha256").update(`stashjar:wallet:${userId}`).digest("hex");
    const address = `0x${hash.slice(0, 40)}`;
    return { address, providerRef: `det:${userId.slice(0, 8)}` };
  },
};
