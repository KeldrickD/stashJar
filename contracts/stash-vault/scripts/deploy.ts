import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  // Deploy MockUSDC
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const mock = await MockUSDC.deploy();
  await mock.waitForDeployment();
  const mockAddr = await mock.getAddress();
  console.log("MockUSDC:", mockAddr);

  // Mint 10,000 mUSDC to deployer (10,000 * 1e6)
  const mintTx = await mock.mint(deployer.address, 10_000n * 1_000_000n);
  await mintTx.wait();
  console.log("Minted 10,000 mUSDC to deployer");

  // Deploy StashVault
  const StashVault = await ethers.getContractFactory("StashVault");
  const vault = await StashVault.deploy(mockAddr);
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();
  console.log("StashVault:", vaultAddr);

  // Approve + deposit 100 mUSDC to prove flow
  const approveTx = await mock.approve(vaultAddr, 100n * 1_000_000n);
  await approveTx.wait();

  const depTx = await vault.depositUSDC(100n * 1_000_000n, deployer.address);
  await depTx.wait();

  const shares = await vault.balanceOf(deployer.address);
  console.log("Deposited 100 mUSDC, shares:", shares.toString());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
