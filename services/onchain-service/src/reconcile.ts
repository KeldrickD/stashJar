import "dotenv/config";
import StashVaultJson from "../../../contracts/stash-vault/artifacts/contracts/StashVault.sol/StashVault.json" assert { type: "json" };

import { Address, decodeEventLog } from "viem";
import { prisma } from "./db";
import { publicClient } from "./chain";

const VAULT_ADDRESS = process.env.VAULT_ADDRESS as Address;
const CHAIN = process.env.CHAIN || "hardhat";
const vaultAbi = (StashVaultJson as any).abi;

export async function reconcileSubmitted(limit = 50) {
  const actions = await prisma.onchainAction.findMany({
    where: { chain: CHAIN, status: "SUBMITTED" },
    take: limit,
    orderBy: { createdAt: "asc" },
  });

  const results: any[] = [];

  for (const a of actions) {
    if (!a.txHash) continue;

    const receipt = await publicClient.getTransactionReceipt({ hash: a.txHash as `0x${string}` });
    if (!receipt || receipt.status !== "success") {
      await prisma.onchainAction.update({
        where: { id: a.id },
        data: { status: "FAILED", blockNumber: receipt?.blockNumber ? Number(receipt.blockNumber) : null },
      });
      results.push({ id: a.id, status: "FAILED" });
      continue;
    }

    let depositParsed: { user: string; usdcAmount: bigint; sharesMinted: bigint } | null = null;
    let withdrawReqParsed: { user: string; shares: bigint; requestId: bigint; recipient: string } | null = null;
    let withdrawRedeemParsed: { user: string; usdcAmount: bigint; requestId: bigint; recipient: string } | null = null;

    for (const log of receipt.logs) {
      if ((log.address as string).toLowerCase() !== VAULT_ADDRESS.toLowerCase()) continue;

      try {
        const decoded = decodeEventLog({
          abi: vaultAbi,
          data: log.data,
          topics: log.topics,
        });

        if (decoded.eventName === "Deposit") {
          const { user, usdcAmount, sharesMinted } = decoded.args as any;
          depositParsed = { user, usdcAmount, sharesMinted };
        }

        if (decoded.eventName === "WithdrawRequested") {
          const { user, shares, requestId, recipient } = decoded.args as any;
          withdrawReqParsed = { user, shares, requestId, recipient };
        }

        if (decoded.eventName === "WithdrawRedeemed") {
          const { user, usdcAmount, requestId, recipient } = decoded.args as any;
          withdrawRedeemParsed = { user, usdcAmount, requestId, recipient };
        }
      } catch {
        // ignore
      }
    }

    if (a.type === "VAULT_DEPOSIT") {
      if (!depositParsed) {
        await prisma.onchainAction.update({
          where: { id: a.id },
          data: {
            metadata: {
              ...(a.metadata as any),
              reconcileError: "no_deposit_event_found",
              lastSeenBlock: receipt?.blockNumber ? Number(receipt.blockNumber) : undefined,
            },
          },
        });

        results.push({ id: a.id, status: "RETRY_NO_EVENT" });
        continue;
      }

      const principalMicros = BigInt((a.metadata as any)?.usdcMicros ?? depositParsed.usdcAmount.toString());

      const existing = await prisma.vaultPosition.findUnique({ where: { userId: a.userId } });
      const prevShares = existing ? BigInt(existing.shares) : 0n;
      const prevPrincipal = existing ? BigInt(existing.totalUsdcMicros) : 0n;

      const newShares = prevShares + depositParsed.sharesMinted;
      const newPrincipal = prevPrincipal + principalMicros;

      await prisma.$transaction(async (tx) => {
        await tx.vaultPosition.upsert({
          where: { userId: a.userId },
          update: {
            vaultAddress: VAULT_ADDRESS,
            shares: newShares.toString(),
            totalUsdcMicros: newPrincipal.toString(),
          },
          create: {
            userId: a.userId,
            vaultAddress: VAULT_ADDRESS,
            shares: newShares.toString(),
            totalUsdcMicros: newPrincipal.toString(),
          },
        });

        await tx.onchainAction.update({
          where: { id: a.id },
          data: {
            status: "CONFIRMED",
            blockNumber: Number(receipt.blockNumber),
            metadata: {
              ...(a.metadata as any),
              depositEvent: {
                user: depositParsed!.user,
                usdcAmount: depositParsed!.usdcAmount.toString(),
                sharesMinted: depositParsed!.sharesMinted.toString(),
              },
            },
          },
        });
      });

      results.push({
        id: a.id,
        status: "CONFIRMED",
        sharesMinted: depositParsed.sharesMinted.toString(),
        usdcAmount: depositParsed.usdcAmount.toString(),
      });
    }

    if (a.type === "VAULT_WITHDRAW_REQUEST") {
      if (!withdrawReqParsed) {
        await prisma.onchainAction.update({
          where: { id: a.id },
          data: {
            metadata: {
              ...(a.metadata as any),
              reconcileError: "no_withdraw_request_event_found",
              lastSeenBlock: receipt?.blockNumber ? Number(receipt.blockNumber) : undefined,
            },
          },
        });
        results.push({ id: a.id, status: "RETRY_NO_EVENT" });
        continue;
      }

      const sharesBurned = BigInt((a.metadata as any)?.shares ?? withdrawReqParsed.shares.toString());
      const principalMicros = BigInt((a.metadata as any)?.usdcMicros ?? "0");

      const existing = await prisma.vaultPosition.findUnique({ where: { userId: a.userId } });
      const prevShares = existing ? BigInt(existing.shares) : 0n;
      const prevPrincipal = existing ? BigInt(existing.totalUsdcMicros) : 0n;

      const newShares = prevShares > sharesBurned ? prevShares - sharesBurned : 0n;
      const newPrincipal = prevPrincipal > principalMicros ? prevPrincipal - principalMicros : 0n;

      await prisma.$transaction(async (tx) => {
        await tx.vaultPosition.upsert({
          where: { userId: a.userId },
          update: {
            vaultAddress: VAULT_ADDRESS,
            shares: newShares.toString(),
            totalUsdcMicros: newPrincipal.toString(),
          },
          create: {
            userId: a.userId,
            vaultAddress: VAULT_ADDRESS,
            shares: newShares.toString(),
            totalUsdcMicros: newPrincipal.toString(),
          },
        });

        await tx.onchainAction.update({
          where: { id: a.id },
          data: {
            status: "CONFIRMED",
            blockNumber: Number(receipt.blockNumber),
            requestId: withdrawReqParsed.requestId.toString(),
            metadata: {
              ...(a.metadata as any),
              withdrawRequestEvent: {
                user: withdrawReqParsed.user,
                shares: withdrawReqParsed.shares.toString(),
                requestId: withdrawReqParsed.requestId.toString(),
                recipient: withdrawReqParsed.recipient,
              },
            },
          },
        });
      });

      results.push({
        id: a.id,
        status: "CONFIRMED",
        requestId: withdrawReqParsed.requestId.toString(),
        shares: withdrawReqParsed.shares.toString(),
      });
    }

    if (a.type === "VAULT_REDEEM") {
      if (!withdrawRedeemParsed) {
        await prisma.onchainAction.update({
          where: { id: a.id },
          data: {
            metadata: {
              ...(a.metadata as any),
              reconcileError: "no_withdraw_redeemed_event_found",
              lastSeenBlock: receipt?.blockNumber ? Number(receipt.blockNumber) : undefined,
            },
          },
        });
        results.push({ id: a.id, status: "RETRY_NO_EVENT" });
        continue;
      }

      await prisma.onchainAction.update({
        where: { id: a.id },
        data: {
          status: "CONFIRMED",
          blockNumber: Number(receipt.blockNumber),
          metadata: {
            ...(a.metadata as any),
            withdrawRedeemedEvent: {
              user: withdrawRedeemParsed.user,
              usdcAmount: withdrawRedeemParsed.usdcAmount.toString(),
              requestId: withdrawRedeemParsed.requestId.toString(),
              recipient: withdrawRedeemParsed.recipient,
            },
          },
        },
      });

      results.push({
        id: a.id,
        status: "CONFIRMED",
        usdcAmount: withdrawRedeemParsed.usdcAmount.toString(),
        requestId: withdrawRedeemParsed.requestId.toString(),
      });
    }
  }

  return results;
}
