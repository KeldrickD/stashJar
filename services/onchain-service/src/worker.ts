import "dotenv/config";
import { allocateBatch } from "./allocate.js";
import { reconcileSubmitted } from "./reconcile.js";
import { requestWithdrawBatch, redeemBatch } from "./withdraw.js";
import { markToMarketBatch } from "./markToMarket.js";
import { watchdogSubmitted } from "./watchdog.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Job = {
  name: string;
  intervalMs: number;
  fn: () => Promise<void>;
};

const running: Record<string, boolean> = {};

async function runJob(job: Job) {
  if (running[job.name]) return;
  running[job.name] = true;
  const started = Date.now();
  try {
    await job.fn();
  } catch (e) {
    console.error(`[${job.name}]`, e);
  } finally {
    const dur = Date.now() - started;
    running[job.name] = false;
    if (dur > 1000) console.log(`[${job.name}] completed in ${dur}ms`);
  }
}

const jobs: Job[] = [
  {
    name: "reconcile",
    intervalMs: Number(process.env.RECONCILE_MS || 3000),
    fn: async () => {
      const res = await reconcileSubmitted(Number(process.env.RECONCILE_LIMIT || 200));
      if (res.length) console.log(`[reconcile] ${res.length} updates`);
    },
  },
  {
    name: "allocate",
    intervalMs: Number(process.env.ALLOCATE_MS || 10000),
    fn: async () => {
      const res = await allocateBatch(Number(process.env.ALLOCATE_LIMIT || 25));
      if (res.length) console.log(`[allocate] submitted ${res.length}`);
    },
  },
  {
    name: "withdrawRequest",
    intervalMs: Number(process.env.WITHDRAW_REQUEST_MS || 10000),
    fn: async () => {
      const res = await requestWithdrawBatch(Number(process.env.WITHDRAW_REQUEST_LIMIT || 25));
      if (res.length) console.log(`[withdraw-request] submitted ${res.length}`);
    },
  },
  {
    name: "redeem",
    intervalMs: Number(process.env.REDEEM_MS || 10000),
    fn: async () => {
      const res = await redeemBatch(Number(process.env.REDEEM_LIMIT || 25));
      if (res.length) console.log(`[redeem] submitted ${res.length}`);
    },
  },
  {
    name: "mark",
    intervalMs: Number(process.env.MARK_MS || 60000),
    fn: async () => {
      const res = await markToMarketBatch(Number(process.env.MARK_LIMIT || 200));
      if (res.length) console.log(`[mark] updated ${res.length}`);
    },
  },
  {
    name: "watchdog",
    intervalMs: Number(process.env.WATCHDOG_MS || 30000),
    fn: async () => {
      const res = await watchdogSubmitted(Number(process.env.WATCHDOG_LIMIT || 200));
      if (res.markedFailed > 0) {
        console.log(`[watchdog] markedFailed ${res.markedFailed}/${res.scanned}`);
      }
    },
  },
];

async function main() {
  console.log("onchain-worker starting", {
    chain: process.env.CHAIN,
    rpc: process.env.RPC_URL,
    vault: process.env.VAULT_ADDRESS,
    usdc: process.env.USDC_ADDRESS,
  });

  for (const job of jobs) {
    setInterval(() => void runJob(job), job.intervalMs);
    await sleep(250); // stagger startup
  }

  for (const job of jobs) void runJob(job); // kick once immediately
}

main().catch((e) => {
  console.error("worker fatal", e);
  process.exit(1);
});
