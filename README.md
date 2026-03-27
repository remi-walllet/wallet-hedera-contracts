# Remi Wallet — Smart Contracts

Solidity smart contract for the [Remi Wallet](https://github.com/remi-walllet/remi-wallet-monorepo) remittance system on [Hedera](https://hedera.com/). Handles session-key authentication, USDC transfers via the HTS precompile, daily spending limits, and on-chain payment request lifecycle.

---

## Contract: RemiWallet.sol

| | |
|---|---|
| **Network** | Hedera Testnet (Chain ID 296) |
| **Solidity** | 0.8.20 |
| **Address** | `0xC85AE96c6Ab3de955509429C1e87Ec5383d2f25d` ([HashScan](https://hashscan.io/testnet/contract/0xC85AE96c6Ab3de955509429C1e87Ec5383d2f25d)) |

### Features

- **Session keys** — register, revoke, and update ephemeral keys with expiry dates
- **Daily spending limits** — per-session-key limits with automatic daily reset (UTC boundary)
- **HTS precompile USDC transfers** — calls `transferToken` on the Hedera Token Service precompile (`0x167`)
- **Payment requests** — create, confirm, or fail on-chain payment records with Tus Giros reference tracking
- **OpenZeppelin Ownable** — owner is a Hedera native threshold key (2-of-3); all admin functions are `onlyOwner`

### Interface

| Function | Access | Description |
|----------|--------|-------------|
| `registerSessionKey(address, uint256, uint256)` | Owner | Register a session key with daily limit and expiry |
| `revokeSessionKey(address)` | Owner | Deactivate a session key |
| `updateSessionKeyLimit(address, uint256)` | Owner | Change the daily limit for an active key |
| `transferUsdc(address, uint256, string)` | Session Key | Transfer USDC via HTS precompile (enforces daily limit) |
| `createPaymentRequest(bytes32, address, uint256, uint256)` | Owner | Create a pending payment request |
| `confirmPayment(bytes32, string, string)` | Owner | Mark a payment as confirmed with references |
| `failPayment(bytes32, string)` | Owner | Mark a payment as failed |
| `getRequest(bytes32)` | View | Get payment request details |
| `getSessionKeyConfig(address)` | View | Get session key configuration |
| `isSessionKeyValid(address)` | View | Check if a session key is active and not expired |
| `getSessionKeyCount()` | View | Total registered session keys |
| `getRemainingDailyLimit(address)` | View | Remaining USDC allowance for the current day |

---

## Repository Structure

```
wallet-hedera-contracts/
├── contracts/
│   └── RemiWallet.sol          # Smart contract
├── test/
│   └── RemiWallet.test.ts      # 40 unit tests (Hardhat + Chai)
├── scripts/
│   ├── deploy.ts               # Deploy using HEDERA_USDC_TOKEN_ID (auto-converts to EVM address)
│   ├── deploy-wallet.ts        # Deploy using HEDERA_USDC_TOKEN_ADDRESS + HTS token association
│   └── sync-abi.ts             # Copies ABI to abi/ after compile (postcompile hook)
├── deployments/
│   └── testnet.json            # Recorded deployment info
├── hardhat.config.ts
├── package.json
└── .env.example
```

---

## Prerequisites

- **Node.js** >= 20.0.0
- **Hedera testnet account** with HBAR for gas fees ([portal.hedera.com](https://portal.hedera.com))

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

| Variable | Description |
|----------|-------------|
| `HEDERA_ACCOUNT_ID` | Your Hedera testnet account (e.g. `0.0.12345`) |
| `HEDERA_OPERATOR_KEY_HEX` | Raw hex ECDSA private key (secp256k1, no `0x` prefix) |
| `HEDERA_USDC_TOKEN_ID` | HTS token ID for USDC on testnet (e.g. `0.0.8260673`) — used by `deploy.ts` |
| `HEDERA_USDC_TOKEN_ADDRESS` | EVM address of the USDC HTS token — used by `deploy-wallet.ts` |
| `HEDERA_TESTNET_RPC_URL` | RPC endpoint (default: `https://testnet.hashio.io/api`) |

### 3. Compile

```bash
npm run compile
```

This compiles the Solidity contracts and automatically syncs the ABI to `abi/RemiWallet.abi.json` via the `postcompile` hook.

### 4. Run tests

```bash
npm test
```

All 40 tests run on a local Hardhat network. HTS precompile calls are not available locally, so transfer tests validate access control and spending-limit logic; actual HTS integration is tested on Hedera testnet.

---

## Deployment

Two deployment scripts are available depending on how you provide the USDC token address.

### Option A: From HTS token ID (recommended)

Automatically converts a Hedera token ID (e.g. `0.0.8260673`) to the corresponding EVM address.

```bash
npm run deploy:testnet
```

### Option B: From EVM address

Uses the EVM address directly and additionally associates the deployed contract with the USDC HTS token via the precompile.

```bash
npm run deploy:wallet:testnet
```

Both scripts write deployment info (address, deployer, tx hash) to `deployments/testnet.json`.

### Local deployment (Hardhat network)

```bash
npm run deploy:local
npm run deploy:wallet:local
```

---

## Commands Reference

| Command | Description |
|---------|-------------|
| `npm run compile` | Compile contracts + sync ABI |
| `npm test` | Run all 40 unit tests |
| `npm run deploy:testnet` | Deploy to Hedera testnet (from token ID) |
| `npm run deploy:wallet:testnet` | Deploy to Hedera testnet (from EVM address + associate) |
| `npm run deploy:local` | Deploy to local Hardhat network |
| `npm run deploy:wallet:local` | Deploy to local Hardhat network (with association) |

---

## Tech Stack

| | |
|---|---|
| **Blockchain** | Hedera Hashgraph (testnet, Chain ID 296) |
| **Smart Contract** | Solidity 0.8.20 |
| **Framework** | Hardhat + TypeScript |
| **Dependencies** | OpenZeppelin Contracts v5 (Ownable) |
| **Testing** | Hardhat + Chai + ethers.js |
| **Verification** | Sourcify via HashScan |

---

## License

Private — All rights reserved.
