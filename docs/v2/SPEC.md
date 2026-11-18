# RemiWallet v2 — Spec

**Status:** design and test work only. No deployment of any kind. Mainnet only after §11.
**Branch:** `feat/v2-hybrid-custody`. **v1 baseline:** tag `v1.0.0`.

## 1. Goal

v2 fixes the v1 review findings and prepares the contract for **hybrid custody**:

- **Stage 1 (launch): Remi-managed custody.** Remi holds the keys that can move user funds.
- **Stage 2 (target): hybrid custody.** An independent third entity holds one key in each threshold, so Remi alone can no longer move user USDC or change critical config.

The contract must work **unchanged in both stages**. Going from Stage 1 to Stage 2 is a key rotation on Hedera accounts, not a redeploy.

## 2. Verified baseline (2026-11-18)

- `main` @ `aeb4911`: `contracts/RemiWallet.sol` is byte-identical to `remi-wallet-monorepo` `staging` @ `2553a4b` (`contracts/contracts/RemiWallet.sol`).
- This repo's suite has 40 tests. The monorepo suite has 54 (tests 41–54 cover the fee system). All 54 pass on v1 with solc 0.8.20.
- Local tests cannot run a successful HTS transfer: there is no precompile mock, so every transfer success path is untested today.
- The 2026-11-18 review's proposal (per-key allocations) on the 54-test suite: 49 pass, 5 fail (3, 37, 48, 50, 51), all from intended changes; 18,085 deployed bytes. **This spec supersedes that proposal (§4).**
- Mainnet v1 `0x23d1818bC9f408d62f118BcF75cfe40683dAe889` (deployed 2026-05-13) is assumed to be built from `v1.0.0`. Bytecode match is **not verified**.

## 3. Custody model

| Key | Controls | Stage 1 holder | Stage 2 holder |
|---|---|---|---|
| Account key A | 1 of 3 on each user's Hedera account | Remi backend | Remi backend |
| Account key B | 1 of 3 on each user's Hedera account | User device | User device |
| Account key C (recovery) | 1 of 3 on each user's Hedera account | Remi backend | **Third entity** |
| Owner account (threshold KeyList) | Contract config (§5) | Remi | Remi + third entity, so that no single party reaches the threshold (D4) |
| Operator (single ECDSA key) | Payment-request records only | Remi backend | Remi backend |
| Guardians (single keys) | Revoke session keys, pause | Remi ops | Remi ops, optionally the third entity too (D5) |
| Session keys | Spend from their own bound account, within limits | User device | User device |

- **Stage 2 property:** no single party can move a user's USDC or change roles or fees.
- **What the contract enforces:** only the account (its own threshold signature) can authorize a session key on it; only the owner changes config; nobody else can move funds.
- **Honesty rule:** in Stage 1, Remi holds A and C, so Remi alone can sign as any user account. All docs, NatSpec and copy say **"Remi-managed"** until Stage 2 is live. Never write "non-custodial" or "collaborative custody".
- **Threshold rule:** if Remi holds 2 keys of a 2-of-3 threshold, Stage 2 adds nothing. The owner threshold must be designed so Remi alone can't reach it (D4).

## 4. Core design: spend from the user's own account

**v1 and the review proposal:** USDC sits in a pool owned by the contract, so "whose money is whose" lives off-chain (RW-01).

**v2:** USDC stays in each user's own Hedera account.

1. The account grants the contract an HTS allowance (HIP-336).
2. The account registers its own session keys on the contract.
3. A session key's `transferUsdc` pulls from **its bound account** through the HTS precompile `transferFrom`. It stays within the key's rate limit and the account's allowance.
4. The contract holds only accrued fees.

**Why this design:**

- **No pool.** It removes the shared balance entirely, so RW-01 can't happen by construction.
- **No owner step per deposit.** The review's design needed an owner transaction on every deposit, which in Stage 2 means a third-entity co-signature on each one.
- **Visible balances.** Balances stay readable natively on Hedera.
- **Custody lives in the account keys,** which is exactly where Stage 2 moves a key.

**This design depends on spike results S1–S5 (Prompt 1).** If S1 or S2 fails, STOP: Remi chooses between:

- **B1:** a per-account ledger inside the contract, with deposit and withdraw. The contract holds funds again and needs a way to attribute deposits.
- **B2:** the review's allocation model, keyed per account, with a separate allocator role. This is weaker in Stage 2.

## 5. Roles and permissions

| Function | Who may call | Notes |
|---|---|---|
| `registerSessionKey(key, dailyLimit, expiresAt)` | The account (`msg.sender`) | Binds `key` to `msg.sender` |
| `updateSessionKeyLimit(key, newLimit)` | The key's bound account | `newLimit ≤ maxDailyLimitUsdc` |
| `revokeSessionKey(key)` | Bound account, any guardian, or owner | Never blocked by pause |
| `transferUsdc(to, amount, memo)` | Active, unexpired session key | Pulls from its bound account; blocked by pause |
| `pause()` | Any guardian or owner | |
| `unpause()` | Owner only | |
| `setOperator`, `setGuardian`, `setMaxDailyLimit`, `setFeeConfig`, `sweepExcess` | Owner | |
| `withdrawFees()` | Owner or `feeRecipient` | Always pays `feeRecipient` |
| `createPaymentRequest`, `confirmPayment`, `failPayment` | Operator | Logic unchanged from v1 |
| `transferOwnership` / `acceptOwnership` | Owner / pending owner | Ownable2Step |
| `renounceOwnership` | Nobody | Always reverts |

**Signing on Hedera:**

- User accounts and the owner account have threshold KeyList keys. They **cannot** send EVM (JSON-RPC) transactions, so they call the contract with `ContractExecuteTransaction` (`@hashgraph/sdk`), signed by enough keys to meet the threshold.
- Session keys, the operator and guardians are single ECDSA keys, so they use normal EVM transactions.

## 6. Invariants (tests must enforce every one)

- **I1:** Only a session key bound to account X can move X's USDC through this contract, and never to `address(this)`.
- **I2:** Only account X can bind a session key to X. A bound key is never rebound to another account.
- **I3:** Owner, operator and guardians cannot move any account's USDC.
- **I4:** Per key, the amount spent in any window of length T is at most `cap + cap × T / 24h`, where `cap = min(dailyLimitUsdc, maxDailyLimitUsdc)`.
- **I5:** The fee is at most 5% of the amount (floor rounding), for every amount and every config.
- **I6:** The contract's USDC balance is always ≥ `accruedFees`. Only fees, and direct transfers by third parties, ever move USDC into the contract.
- **I7:** Revoked, expired or paused keys cannot spend. Revocation is always possible.
- **I8:** Ownership cannot be renounced, and a transfer needs acceptance by the new owner.

## 7. Contract spec

**Constants:** `HTS_PRECOMPILE = 0x167`, `HTS_SUCCESS = 22`, `MAX_FEE_BPS = 500`, `MAX_AMOUNT = uint64(type(int64).max)`, `REFILL_PERIOD = 1 days`.

**Constructor:** `(address usdc, address operator_, uint256 maxDailyLimitUsdc_)`, with `Ownable(msg.sender)`.

- Inputs: non-zero addresses; `0 < max ≤ MAX_AMOUNT`.
- Deployment then transfers ownership to the owner KeyList account, which accepts.

**State:**

- `usdcTokenAddress` (immutable), `operator`, `guardians`, `maxDailyLimitUsdc`
- `sessionKeys`, `sessionKeyList` (no duplicates), `paymentRequests`
- `feeRecipient`, `feeBasisPoints`, `minFeeUsdc`, `accruedFees`

**`SessionKeyConfig` fields:** `account`, `active`, `dailyLimitUsdc`, `available`, `lastRefill`, `expiresAt`, `registeredAt`.

**Rate limit (token bucket):**

- `cap = min(dailyLimitUsdc, maxDailyLimitUsdc)`
- `level = min(cap, available + elapsed × cap / REFILL_PERIOD)`
- A spend sets `available = level − amount` and `lastRefill = now`.
- A new key starts full. Lowering `maxDailyLimitUsdc` immediately caps every key, which makes it an emergency lever.

**`registerSessionKey` rules:**

- `key ≠ 0` and `key ≠ msg.sender`; not paused.
- `expiresAt > now`; `0 < dailyLimit ≤ maxDailyLimitUsdc`.
- **Unbound key:** bind it to `msg.sender` and push it to the list once.
- **Already bound:** require `account == msg.sender`, and require the key to be inactive or expired. Keep its bucket level, capped at the new limit.

**`transferUsdc` order of operations:**

1. **Checks:** active, not expired, not paused; `to ≠ 0`; `to ≠ address(this)`; `0 < amount ≤ MAX_AMOUNT`.
2. **Bucket:** charge the gross amount.
3. **Fee:** compute it.
4. **Effects:** update the bucket and `accruedFees`.
5. **Transfers:** HTS `transferFrom(token, account, to, net)`, then, if `fee > 0`, HTS `transferFrom(token, account, address(this), fee)`.
6. **Events.**

**Fee:**

- `fee = 0` if `feeRecipient == 0`.
- Otherwise `fee = max(amount × bps / 10000, minFeeUsdc)`, capped at `amount × MAX_FEE_BPS / 10000`.
- Fees are off when `bps == 0` and `minFee == 0` (D1).

**Views:**

- **`getRemainingDailyLimit(key)`:** the bucket level; 0 if the key is invalid or the contract is paused.
- **`getSpendableNow(key)`:** `min(bucket, allowance(account → this), balanceOf(account))`, read through the token's ERC-20 facade. Views only.
- Also `calculateFee`, `getRequest`, `getSessionKeyConfig`, `isSessionKeyValid`, `getSessionKeyCount`, `isGuardian`.

**Events:**

- `SessionKeyRegistered(key, account, dailyLimit, expiresAt)` and `SessionKeyRevoked(key, by)`
- `SessionKeyLimitUpdated`
- `UsdcTransferred(sessionKey, from, to, netAmount, feeAmount, memo)`
- `FeeAccrued(sessionKey, amount)` and `FeesWithdrawn(recipient, amount)`
- `ExcessSwept(to, amount)`
- `OperatorChanged`, `GuardianSet`, `MaxDailyLimitChanged`
- `Paused` / `Unpaused` (OpenZeppelin)
- `FeeConfigUpdated` and the payment-request events, unchanged

Index the addresses.

## 8. Findings → resolution

| Finding | v2 resolution | Prompt |
|---|---|---|
| RW-01 shared pool (High) | No pool; spend from the bound account (§4) | 4, 5 |
| RW-02 double limit at midnight | Token bucket. Guardians give fast revocation, which is what makes the bucket worth it, plus the `maxDailyLimit` lever | 3, 4 |
| RW-06 min fee gets around the 5% cap | Fee capped at 5% in every case | 6 |
| RW-08 fee recipient blocks payments | Fees accrue in the contract; `withdrawFees()` pays them out | 6 |
| RW-09 renounce locks funds | Ownable2Step; renounce reverts | 3 |
| Low: revoke + re-register resets the budget or duplicates the list | Bucket kept; list stays unique | 4 |
| Low: int64 truncation | `MAX_AMOUNT` bound before every HTS call | 4, 5 |
| Low: expired-but-active keys can't be re-registered | The account may re-register an expired key | 4 |
| Low: `usdcTokenAddress` mutable | Immutable | 3 |

**Not addressed:** payment-request `expiresAt` not stored and `Expired` unreachable (records are owner/operator attestations only); upgradeability (deliberately none).

## 9. Decisions

**Taken (change them only by editing this spec):**

- **D1 — Fees:** a flat fee is allowed (`bps = 0`, `minFee > 0`), still capped at 5%. Fees are off only with `bps = 0` and `minFee = 0`, or with `feeRecipient` unset. This follows the review; v1 test 48 changes.
- **D2 — Pause:** pause blocks `transferUsdc` and `registerSessionKey`. Revocation always works. Only the owner unpauses.
- **D3 — New keys:** a new key starts with a full bucket.
- **D6 — Events:** event signatures change in v2. The indexer must be updated before any v2 deployment.

**Open (Remi decides before mainnet):**

- **D4:** the owner threshold layout for Stage 2, so that no single party can sign alone.
- **D5:** whether the third entity is also a guardian.
- **D7:** what the third entity legally is, and its agreement. This needs legal and compliance review.

## 10. Integration impact (outside this repo; not part of these prompts)

- **Session key registration** becomes an account-signed `ContractExecuteTransaction` (device B + backend A), no longer an operator call.
- **Allowance:** each account grants one with `AccountAllowanceApproveTransaction` (A + B).
- **Payments:** the app keeps signing payments with the session key. Mirror Node now shows the payer's own account as the sender.
- **Operator key:** the backend uses it for payment records. Owner calls become rare multi-signed SDK transactions.
- **Indexer:** update it for the new events (D6).
- **Withdrawals:** the current withdrawal path signs with A + C from the backend alone, which **won't work in Stage 2** because C moves to the third entity. Withdrawals then need A + B, or must go through this contract.
- **v1 → v2 migration:** revoke the v1 keys, move out any v1 pool balance, switch addresses, update the docs.

## 11. Mainnet readiness gate (all required)

1. Spike S1–S5 passed on testnet (`docs/v2/SPIKE-RESULTS.md`).
2. Full suite green, including attack replays and invariant tests (Prompt 7).
3. Testnet rehearsal passed end to end with real KeyList accounts and real HTS (`docs/v2/TESTNET-REHEARSAL.md`).
4. Backend and frontend integrated and run on staging against testnet.
5. External audit of the exact commit to be deployed; all High and Medium findings fixed.
6. Legal and compliance review of the custody arrangement (Stage 1 disclosure; Stage 2 agreement).
7. Monitoring and alerts in place; the guardian runbook (pause and revoke) tested.
8. v1 migration plan approved.
9. After deployment, the source verified on Sourcify against a signed tag.

## 12. Out of scope

Backend, frontend and indexer changes; Stellar/Soroban; token work; any mainnet configuration.
