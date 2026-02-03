import "dotenv/config";
import { prisma } from "./db.js";
import { publicClient } from "./chain.js";

const CHAIN = process.env.CHAIN || "hardhat";
const STALE = Number(process.env.WATCHDOG_STALE_SECONDS || 600); // 10m default
const HARDFAIL = Number(process.env.WATCHDOG_HARDFAIL_SECONDS || 1800); // 30m default

export async function watchdogSubmitted(limit = 200) {
  const now = Date.now();

  const stuck = await prisma.onchainAction.findMany({
    where: { chain: CHAIN, status: "SUBMITTED" },
    take: limit,
    orderBy: { createdAt: "asc" },
  });

  let marked = 0;

  for (const a of stuck) {
    const ageSec = Math.floor((now - new Date(a.createdAt).getTime()) / 1000);

    if (!a.txHash) {
      await prisma.onchainAction.update({
        where: { id: a.id },
        data: {
          status: "FAILED",
          metadata: { ...(a.metadata as any), watchdog: { reason: "missing_txHash", ageSec } },
        },
      });
      marked++;
      continue;
    }

    if (ageSec < STALE) continue;

    let receiptFound = false;
    try {
      const receipt = await publicClient.getTransactionReceipt({
        hash: a.txHash as `0x${string}`,
      });
      if (receipt) receiptFound = true;
    } catch (e) {
      // ignore RPC errors here; fall through to hardfail logic
    }

    if (receiptFound) continue; // reconcile loop will confirm

    if (ageSec < HARDFAIL) continue;

    await prisma.onchainAction.update({
      where: { id: a.id },
      data: {
        status: "FAILED",
        metadata: { ...(a.metadata as any), watchdog: { reason: "tx_not_found_or_rpc_fail", ageSec } },
      },
    });
    marked++;
  }

  return { scanned: stuck.length, markedFailed: marked };
}
