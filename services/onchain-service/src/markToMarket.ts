import "dotenv/config";
import { Address } from "viem";
import { prisma } from "./db";
import { previewRedeem } from "./shareMath";

const VAULT_ADDRESS = process.env.VAULT_ADDRESS as Address;

export async function markToMarketBatch(limit = 50) {
  const positions = await prisma.vaultPosition.findMany({
    take: limit,
    orderBy: { updatedAt: "asc" },
  });

  const out: any[] = [];

  for (const p of positions) {
    const shares = BigInt(p.shares);
    const value = shares === 0n ? 0n : await previewRedeem(VAULT_ADDRESS, shares);

    await prisma.vaultPosition.update({
      where: { userId: p.userId },
      data: {
        currentValueUsdcMicros: value.toString(),
        lastMarkedAt: new Date(),
      },
    });

    out.push({
      userId: p.userId,
      shares: p.shares,
      currentValueUsdcMicros: value.toString(),
    });
  }

  return out;
}
