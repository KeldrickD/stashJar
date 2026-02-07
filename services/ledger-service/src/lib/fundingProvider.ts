/**
 * Funding session provider abstraction. Creates short-lived onramp session tokens
 * bound to the user's wallet (e.g. Coinbase CDP for FundCard/FundButton).
 */
import { createCdpSessionToken } from "./cdpSessionToken";

export type CreateFundingSessionParams = {
  userId: string;
  walletAddress: string;
  chain: string;
  returnTo?: string | null;
  context?: "pwa" | "miniapp";
  clientIp: string;
  apiKey: string;
  ttlMinutes: number;
};

export type CreateFundingSessionResult =
  | { ok: true; sessionToken: string; expiresAt: string }
  | { ok: false; error: string; statusCode?: number };

/**
 * Create a funding session (e.g. CDP Onramp token) for the given user wallet.
 * Server decides wallet from DB; token is short-lived and bound to that address.
 */
export async function createFundingSession(
  params: CreateFundingSessionParams,
): Promise<CreateFundingSessionResult> {
  const { walletAddress, clientIp, apiKey, ttlMinutes } = params;

  const result = await createCdpSessionToken({
    walletAddress,
    clientIp,
    apiKey,
    ttlMinutes,
  });

  if (!result.ok) {
    return {
      ok: false,
      error: result.error ?? "Could not create funding session",
      statusCode: result.statusCode,
    };
  }

  return {
    ok: true,
    sessionToken: result.token,
    expiresAt: result.expiresAt,
  };
}
