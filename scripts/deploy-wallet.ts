import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying RemiWallet with account:", deployer.address);

  const usdcTokenAddress = process.env.HEDERA_USDC_TOKEN_ADDRESS;
  if (!usdcTokenAddress) {
    throw new Error(
      "HEDERA_USDC_TOKEN_ADDRESS env var required (EVM address of USDC HTS token)"
    );
  }

  console.log("USDC token address:", usdcTokenAddress);

  const Factory = await ethers.getContractFactory("RemiWallet");
  const wallet = await Factory.deploy(usdcTokenAddress);
  await wallet.waitForDeployment();

  const address = await wallet.getAddress();
  console.log("RemiWallet deployed to:", address);
  console.log(`Hashscan URL: https://hashscan.io/testnet/contract/${address}`);

  // Associate the contract with the USDC HTS token via precompile
  console.log("Associating contract with USDC HTS token...");
  try {
    const HTS_PRECOMPILE = "0x0000000000000000000000000000000000000167";
    const htsAbi = [
      "function associateToken(address account, address token) external returns (int64)",
    ];
    const hts = new ethers.Contract(HTS_PRECOMPILE, htsAbi, deployer);
    const tx = await hts.associateToken(address, usdcTokenAddress);
    const receipt = await tx.wait();
    console.log("Token association tx:", receipt.hash);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("Token association failed (may already be associated):", msg);
  }

  const deploymentsDir = path.resolve(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const deployment = {
    RemiWallet: address,
    usdcTokenAddress,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    network: "hedera_testnet",
    chainId: 296,
  };

  fs.writeFileSync(
    path.join(deploymentsDir, "testnet-wallet.json"),
    JSON.stringify(deployment, null, 2)
  );
  console.log("Deployment info written to deployments/testnet-wallet.json");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
