import "dotenv/config";
import StashVaultJson from "../../../contracts/stash-vault/artifacts/contracts/StashVault.sol/StashVault.json" assert { type: "json" };

import { Address } from "viem";
import { prisma } from "./db";
import { account, walletClient } from "./chain";
import { sharesForExactUsdc } from "./shareMath";

const VAULT_ADDRESS = process.env.VAULT_ADDRESS as Address;
const CHAIN = process.env.CHAIN || "hardhat";
const vaultAbi = (StashVaultJson as any).abi;

function centsToUsdcMicros(cents: number): bigint {
  return BigInt(cents) * 10_000n;
}

export async function requestWithdrawBatch(limit = 10) {
  const results: any[] = [];

  const intents = await prisma.paymentIntent.findMany({
    where: { type: "WITHDRAW", status: "PROCESSING" },
    take: 200,
    orderBy: { createdAt: "asc" },
  });

  for (const pi of intents) {
    if (results.length >= limit) break;

    const idempo = `vault_withdraw_request_${CHAIN}_${pi.id}`;

    try {
      await prisma.onchainAction.create({
        data: {
          userId: pi.userId,
          type: "VAULT_WITHDRAW_REQUEST",
          status: "CREATED",
          chain: CHAIN,
          paymentIntentId: pi.id,
          idempotencyKey: idempo,
          metadata: { amountCents: pi.amountCents },
        },
      });
    } catch {
      continue; // claimed elsewhere
    }

    const pos = await prisma.vaultPosition.findUnique({ where: { userId: pi.userId } });
    if (!pos) {
      await prisma.onchainAction.update({
        where: { idempotencyKey: idempo },
        data: { status: "FAILED", metadata: { amountCents: pi.amountCents, error: "no_vault_position" } },
      });
      results.push({ paymentIntentId: pi.id, status: "FAILED_no_position" });
      continue;
    }

    const usdcMicros = centsToUsdcMicros(pi.amountCents);
    const maxShares = BigInt(pos.shares);
    const rail = (pi.metadata as any)?.rail ?? "BANK";
    const recipient =
      rail === "ONCHAIN" && (pi.metadata as any)?.recipient
        ? ((pi.metadata as any).recipient as Address)
        : account.address;

    const shares = await sharesForExactUsdc({
      vault: VAULT_ADDRESS,
      targetUsdcMicros: usdcMicros,
      maxShares,
    });

    const currentShares = BigInt(pos.shares);
    if (shares > currentShares) {
      await prisma.onchainAction.update({
        where: { idempotencyKey: idempo },
        data: { status: "FAILED", metadata: { amountCents: pi.amountCents, usdcMicros: usdcMicros.toString(), shares: shares.toString(), error: "insufficient_shares" } },
      });
      results.push({ paymentIntentId: pi.id, status: "FAILED_insufficient_shares" });
      continue;
    }

    const txHash = await walletClient.writeContract({
      address: VAULT_ADDRESS,
      abi: vaultAbi,
      functionName: "requestWithdraw",
      args: [shares, recipient], // recipient decides rail
    });

    await prisma.onchainAction.update({
      where: { idempotencyKey: idempo },
      data: {
        status: "SUBMITTED",
        txHash,
        metadata: {
          amountCents: pi.amountCents,
          usdcMicros: usdcMicros.toString(),
          shares: shares.toString(),
          recipient,
          rail,
        },
      },
    });

    results.push({ paymentIntentId: pi.id, txHash });
  }

  return results;
}

export async function redeemBatch(limit = 10) {
  const results: any[] = [];

  const reqs = await prisma.onchainAction.findMany({
    where: { chain: CHAIN, type: "VAULT_WITHDRAW_REQUEST", status: "CONFIRMED", requestId: { not: null } },
    take: 200,
    orderBy: { createdAt: "asc" },
  });

  for (const r of reqs) {
    if (results.length >= limit) break;

    const redeemIdempo = `vault_redeem_${CHAIN}_${r.id}`;
    try {
      await prisma.onchainAction.create({
        data: {
          userId: r.userId,
          type: "VAULT_REDEEM",
          status: "CREATED",
          chain: CHAIN,
          paymentIntentId: r.paymentIntentId,
          idempotencyKey: redeemIdempo,
          metadata: { withdrawRequestActionId: r.id, requestId: r.requestId },
        },
      });
    } catch {
      continue;
    }

    const txHash = await walletClient.writeContract({
      address: VAULT_ADDRESS,
      abi: vaultAbi,
      functionName: "redeem",
      args: [BigInt(r.requestId!)],
    });

    await prisma.onchainAction.update({
      where: { idempotencyKey: redeemIdempo },
      data: { status: "SUBMITTED", txHash },
    });

    results.push({ redeemActionId: redeemIdempo, txHash });
  }

  return results;
}
