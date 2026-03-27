import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const operatorKey = process.env.HEDERA_OPERATOR_KEY_HEX ?? "";
const formattedKey = operatorKey.startsWith("0x")
  ? operatorKey
  : `0x${operatorKey}`;

const config: HardhatUserConfig = {
  solidity: "0.8.20",
  networks: {
    hedera_testnet: {
      url:
        process.env.HEDERA_TESTNET_RPC_URL || "https://testnet.hashio.io/api",
      chainId: 296,
      accounts: operatorKey ? [formattedKey] : [],
      gasPrice: 3600_000_000_000,
      gas: 5_000_000,
      timeout: 120_000,
    },
  },
  etherscan: {
    apiKey: {
      hedera_testnet: "abc", // placeholder — Hashscan doesn't require a real key
    },
    customChains: [
      {
        network: "hedera_testnet",
        chainId: 296,
        urls: {
          apiURL: "https://sourcify.hashscan.io",
          browserURL: "https://hashscan.io/testnet",
        },
      },
    ],
  },
  sourcify: {
    enabled: false, // use etherscan config above
  },
};

export default config;
