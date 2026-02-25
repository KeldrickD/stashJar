import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { z } from "zod";
import { getAddress, isAddress, verifyMessage } from "viem";
import { AccountType, type PrismaClient } from "../generated/client";

type WalletAuthDeps = {
  prisma: PrismaClient;
  AUTH_PEPPER: string;
  SESSION_TTL_DAYS: number;
  hashWithPepper: (value: string) => string;
  generateRawSession: () => string;
  setSessionCookie: (reply: any, rawSession: string, ttlDays: number) => void;
  getClientIP: (req: any) => string;
  sanitizeReturnTo: (value?: string | null) => string | null;
};

const AuthWalletNonceSchema = z.object({
  address: z.string().min(1),
  returnTo: z.string().optional(),
});

const AuthWalletVerifySchema = z.object({
  address: z.string().min(1),
  message: z.string().min(1),
  signature: z.string().min(1),
  returnTo: z.string().optional(),
});

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function registerWalletAuthRoutes(app: FastifyInstance, deps: WalletAuthDeps) {
  app.post("/auth/wallet/nonce", async (req, reply) => {
    const parsed = AuthWalletNonceSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (!deps.AUTH_PEPPER) {
      return reply.code(503).send({ error: "auth_not_configured", message: "AUTH_PEPPER not set" });
    }
    if (!isAddress(parsed.data.address)) {
      return reply.code(400).send({ error: "invalid_address" });
    }

    const address = getAddress(parsed.data.address);
    const nonce = base64url(crypto.randomBytes(16));
    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const returnTo = deps.sanitizeReturnTo(parsed.data.returnTo) ?? null;
    const message = [
      "Sign in to StashJar",
      "",
      `Address: ${address}`,
      `Nonce: ${nonce}`,
      `Issued At: ${issuedAt}`,
      `Expires At: ${expiresAt}`,
    ].join("\n");

    await deps.prisma.authToken.create({
      data: {
        email: `wallet:${address.toLowerCase()}`,
        tokenHash: deps.hashWithPepper(`wallet:${address.toLowerCase()}:${nonce}`),
        purpose: "wallet_nonce",
        returnTo,
        expiresAt: new Date(expiresAt),
        ip: deps.getClientIP(req),
        userAgent: (req.headers["user-agent"] as string) ?? undefined,
      },
    });

    return reply.send({ address, nonce, issuedAt, expiresAt, message });
  });

  app.post("/auth/wallet/verify", async (req, reply) => {
    const parsed = AuthWalletVerifySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (!deps.AUTH_PEPPER) {
      return reply.code(503).send({ error: "auth_not_configured", message: "AUTH_PEPPER not set" });
    }
    if (!isAddress(parsed.data.address)) {
      return reply.code(400).send({ error: "invalid_address" });
    }

    const address = getAddress(parsed.data.address);
    const nonceMatch = /Nonce:\s*([A-Za-z0-9\-_]+)/.exec(parsed.data.message);
    if (!nonceMatch?.[1]) return reply.code(400).send({ error: "wallet_nonce_missing" });
    const tokenHash = deps.hashWithPepper(`wallet:${address.toLowerCase()}:${nonceMatch[1]}`);
    const nonceRow = await deps.prisma.authToken.findFirst({
      where: { tokenHash, consumedAt: null, expiresAt: { gt: new Date() }, purpose: "wallet_nonce" },
    });
    if (!nonceRow) return reply.code(400).send({ error: "wallet_nonce_invalid" });

    const verified = await verifyMessage({
      address,
      message: parsed.data.message,
      signature: parsed.data.signature as `0x${string}`,
    });
    if (!verified) return reply.code(401).send({ error: "wallet_signature_invalid" });

    await deps.prisma.authToken.update({ where: { id: nonceRow.id }, data: { consumedAt: new Date() } });

    const existingWallet = await deps.prisma.userWallet.findFirst({
      where: { address: { equals: address, mode: "insensitive" as const } },
      select: { userId: true },
    });

    let userId = existingWallet?.userId;
    if (!userId) {
      const user = await deps.prisma.user.create({ data: {} });
      userId = user.id;
      await deps.prisma.account.create({ data: { userId, type: AccountType.USER_STASH } });
      await deps.prisma.userWallet.create({
        data: {
          userId,
          address: address.toLowerCase(),
          walletType: "EXTERNAL",
          chain: "base",
        },
      });
    }

    const rawSession = deps.generateRawSession();
    const sessionHash = deps.hashWithPepper(rawSession);
    const sessionExpiresAt = new Date(Date.now() + deps.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    await deps.prisma.session.create({
      data: {
        userId,
        sessionHash,
        expiresAt: sessionExpiresAt,
        ip: deps.getClientIP(req),
        userAgent: (req.headers["user-agent"] as string) ?? undefined,
      },
    });
    deps.setSessionCookie(reply, rawSession, deps.SESSION_TTL_DAYS);

    const returnTo =
      deps.sanitizeReturnTo(parsed.data.returnTo) ?? deps.sanitizeReturnTo(nonceRow.returnTo ?? undefined) ?? "/";
    return reply.send({ ok: true, userId, returnTo });
  });
}
