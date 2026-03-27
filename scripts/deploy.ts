import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

function tokenIdToEvmAddress(tokenId: string): string {
  const parts = tokenId.split(".");
  if (parts.length !== 3) throw new Error(`Invalid token ID: ${tokenId}`);
  const entityNum = BigInt(parts[2]);
  return "0x" + entityNum.toString(16).padStart(40, "0");
}

async function main() {
  const [deployer] = await ethers.getSigners();

  const usdcTokenId = process.env.HEDERA_USDC_TOKEN_ID;
  if (!usdcTokenId) {
    throw new Error("HEDERA_USDC_TOKEN_ID env var required (e.g. 0.0.8260673)");
  }
  const usdcAddress = tokenIdToEvmAddress(usdcTokenId);

  console.log("Deploying RemiWallet with account:", deployer.address);
  console.log("USDC token address:", usdcAddress, `(from ${usdcTokenId})`);

  const Factory = await ethers.getContractFactory("RemiWallet");
  const wallet = await Factory.deploy(usdcAddress, {
    gasLimit: 5_000_000,
    gasPrice: ethers.parseUnits("3600", "gwei"),
  });
  console.log("Transaction submitted, waiting for deployment...");
  await wallet.waitForDeployment();

  const address = await wallet.getAddress();
  const deployTx = wallet.deploymentTransaction();
  console.log("RemiWallet deployed to:", address);
  console.log(
    `Hashscan URL: https://hashscan.io/testnet/contract/${address}`
  );

  const deploymentsDir = path.resolve(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const deployment = {
    network: "hedera_testnet",
    chainId: 296,
    RemiWallet: {
      address,
      deployedAt: new Date().toISOString(),
      deployer: deployer.address,
      txHash: deployTx?.hash ?? null,
    },
  };

  fs.writeFileSync(
    path.join(deploymentsDir, "testnet.json"),
    JSON.stringify(deployment, null, 2)
  );
  console.log("Deployment info written to deployments/testnet.json");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
