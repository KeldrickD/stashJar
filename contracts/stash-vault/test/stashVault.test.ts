import { expect } from "chai";
import { ethers } from "hardhat";

describe("StashVault", function () {
  it("deposit -> requestWithdraw -> redeem works", async () => {
    const [owner, user] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();
    await usdc.waitForDeployment();

    // mint user 1,000 USDC
    await usdc.mint(user.address, 1000n * 1_000_000n);

    const StashVault = await ethers.getContractFactory("StashVault");
    const vault = await StashVault.deploy(await usdc.getAddress());
    await vault.waitForDeployment();

    // approve and deposit 100 USDC
    await usdc.connect(user).approve(await vault.getAddress(), 100n * 1_000_000n);
    await vault.connect(user).depositUSDC(100n * 1_000_000n, user.address);

    const shares = await vault.balanceOf(user.address);
    expect(Number(shares)).to.be.greaterThan(0);

    // request withdraw half shares
    const half = shares / 2n;
    const reqTx = await vault.connect(user).requestWithdraw(half, user.address);
    const receipt = await reqTx.wait();

    const ev = receipt!.logs
      .map((l: any) => {
        try {
          return vault.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((x: any) => x && x.name === "WithdrawRequested");

    const requestId = ev!.args.requestId as bigint;

    await vault.connect(user).redeem(requestId);

    const bal = await usdc.balanceOf(user.address);
    if (!(bal > 900n * 1_000_000n)) {
      throw new Error(`Expected balance > 900 USDC, got ${bal.toString()}`);
    }
  });
});
