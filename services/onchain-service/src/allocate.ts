import "dotenv/config";
import StashVaultJson from "../../../contracts/stash-vault/artifacts/contracts/StashVault.sol/StashVault.json" assert { type: "json" };
import MockUSDCJson from "../../../contracts/stash-vault/artifacts/contracts/MockUSDC.sol/MockUSDC.json" assert { type: "json" };

import { Address } from "viem";
import { prisma } from "./db";
import { account, publicClient, walletClient } from "./chain";

const USDC_ADDRESS = process.env.USDC_ADDRESS as Address;
const VAULT_ADDRESS = process.env.VAULT_ADDRESS as Address;
const CHAIN = process.env.CHAIN || "hardhat";

const usdcAbi = (MockUSDCJson as any).abi;
const vaultAbi = (StashVaultJson as any).abi;

function centsToUsdcMicros(amountCents: number): bigint {
  return BigInt(amountCents) * 10_000n;
}

async function ensureUserWallet(userId: string): Promise<Address> {
  const existing = await prisma.userWallet.findUnique({ where: { userId } });
  if (existing) return existing.address as Address;

  const created = await prisma.userWallet.create({
    data: { userId, address: account.address },
  });
  return created.address as Address;
}

export async function allocateOne(paymentIntentId: string) {
  const pi = await prisma.paymentIntent.findUnique({ where: { id: paymentIntentId } });
  if (!pi) throw new Error("PaymentIntent not found");
  if (pi.type !== "DEPOSIT") throw new Error("Not a deposit intent");
  if (pi.status !== "SETTLED") throw new Error("Deposit not SETTLED yet");

  const beneficiary = await ensureUserWallet(pi.userId);
  const usdcMicros = centsToUsdcMicros(pi.amountCents);
  const idempo = `vault_deposit_${CHAIN}_${pi.id}`;

  const existingAction = await prisma.onchainAction.findUnique({ where: { idempotencyKey: idempo } });
  if (existingAction?.status === "CONFIRMED" || existingAction?.status === "SUBMITTED") {
    return existingAction;
  }

  const action =
    existingAction ??
    (await prisma.onchainAction.create({
      data: {
        userId: pi.userId,
        type: "VAULT_DEPOSIT",
        status: "CREATED",
        chain: CHAIN,
        paymentIntentId: pi.id,
        idempotencyKey: idempo,
        metadata: {
          beneficiary,
          amountCents: pi.amountCents,
          usdcMicros: usdcMicros.toString(),
        },
      },
    }));

  // Check allowance
  const allowance: bigint = await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: usdcAbi,
    functionName: "allowance",
    args: [account.address, VAULT_ADDRESS],
  });

  if (allowance < usdcMicros) {
    const approveHash = await walletClient.writeContract({
      address: USDC_ADDRESS,
      abi: usdcAbi,
      functionName: "approve",
      args: [VAULT_ADDRESS, usdcMicros],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
  }

  const txHash = await walletClient.writeContract({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    functionName: "depositUSDC",
    args: [usdcMicros, beneficiary],
  });

  await prisma.onchainAction.update({
    where: { id: action.id },
    data: { status: "SUBMITTED", txHash },
  });

  return { ...action, txHash };
}

export async function allocateBatch(limit = 10) {
  const results: any[] = [];

  const candidates = await prisma.paymentIntent.findMany({
    where: { type: "DEPOSIT", status: "SETTLED" },
    take: 200,
    orderBy: { createdAt: "asc" },
  });

  for (const pi of candidates) {
    if (results.length >= limit) break;

    const idempo = `vault_deposit_${CHAIN}_${pi.id}`;

    try {
      await prisma.onchainAction.create({
        data: {
          userId: pi.userId,
          type: "VAULT_DEPOSIT",
          status: "CREATED",
          chain: CHAIN,
          paymentIntentId: pi.id,
          idempotencyKey: idempo,
          metadata: { amountCents: pi.amountCents },
        },
      });
    } catch (e: any) {
      // Unique violation => already claimed by another worker
      continue;
    }

    results.push(await allocateOne(pi.id));
  }

  return results;
}
