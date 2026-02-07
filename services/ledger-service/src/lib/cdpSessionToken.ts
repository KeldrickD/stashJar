/**
 * Coinbase Developer Platform: create Onramp session token for FundCard/FundButton.
 * Requires CDP_PROJECT_ID and CDP_API_KEY (Secret API Key). Session tokens expire in 5 minutes.
 * @see https://docs.cdp.coinbase.com/onramp-&-offramp/session-token-authentication
 */

const CDP_TOKEN_URL = "https://api.developer.coinbase.com/onramp/v1/token";

export type CreateSessionTokenParams = {
  walletAddress: string;
  clientIp: string;
  apiKey: string;
  /** Session TTL in minutes (default 5). */
  ttlMinutes?: number;
};

export type CreateSessionTokenResult =
  | { ok: true; token: string; expiresAt: string }
  | { ok: false; statusCode?: number; error?: string };

/**
 * Create a short-lived Onramp session token bound to the wallet address.
 * Uses Bearer apiKey; if CDP requires JWT, replace with signed JWT per CDP auth guide.
 */
export async function createCdpSessionToken(
  params: CreateSessionTokenParams,
): Promise<CreateSessionTokenResult> {
  const { walletAddress, clientIp, apiKey, ttlMinutes = 5 } = params;
  const ttlMs = Math.min(15, Math.max(1, ttlMinutes)) * 60 * 1000;
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();

  try {
    const res = await fetch(CDP_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        addresses: [
          {
            address: walletAddress,
            blockchains: ["base", "ethereum"],
          },
        ],
        assets: ["USDC", "ETH"],
        clientIp,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return {
        ok: false,
        statusCode: res.status,
        error: res.status === 401 ? "CDP auth failed (check API key or use JWT)" : text || res.statusText,
      };
    }

    const data = (await res.json()) as { token?: string; channel_id?: string };
    const token = data?.token;
    if (!token || typeof token !== "string") {
      return { ok: false, error: "No token in CDP response" };
    }

    return { ok: true, token, expiresAt };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "CDP request failed" };
  }
}

export function isCdpConfigured(projectId: string | undefined, apiKey: string | undefined): boolean {
  return !!(projectId?.trim() && apiKey?.trim());
}
