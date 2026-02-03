import { allocateBatch } from "./allocate.js";
import { reconcileSubmitted } from "./reconcile.js";
import { requestWithdrawBatch, redeemBatch } from "./withdraw.js";
import { markToMarketBatch } from "./markToMarket.js";

const cmd = process.argv[2];

async function main() {
  if (cmd === "allocate") {
    const res = await allocateBatch(10);
    console.log(res);
    return;
  }
  if (cmd === "reconcile") {
    const res = await reconcileSubmitted(50);
    console.log(res);
    return;
  }
  if (cmd === "withdraw-request") {
    const res = await requestWithdrawBatch(10);
    console.log(res);
    return;
  }
  if (cmd === "redeem") {
    const res = await redeemBatch(10);
    console.log(res);
    return;
  }
  if (cmd === "mark") {
    const res = await markToMarketBatch(50);
    console.log(res);
    return;
  }
  console.log("Usage: pnpm allocate | pnpm reconcile | pnpm withdraw-request | pnpm redeem | pnpm mark");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
