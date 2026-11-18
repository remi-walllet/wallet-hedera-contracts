## Standing rules (every prompt)

1. **Where:** work only in `wallet-hedera-contracts`, on branch `feat/v2-hybrid-custody`.
2. **No mainnet:** never deploy to mainnet; never add a `hedera_mainnet` network. Testnet only in Prompts 1 and 8.
3. **Secrets:** never commit `.env`, keys or mnemonics. Never print private keys.
4. **Toolchain:** Solidity 0.8.20 and OpenZeppelin v5, both already installed. Ask before adding any dependency.
5. **USDC transfers** go only through the HTS precompile `0x167` (`transferToken` / `transferFrom`). The ERC-20 facade is for views only (`balanceOf`, `allowance`).
6. **Hedera specifics:** take function signatures from the official `IHederaTokenService.sol` and response codes from `HederaResponseCodes.sol` (hashgraph/hedera-smart-contracts). Never invent numbers.
7. **Custody wording:** never "non-custodial" or "collaborative custody". Stage 1 = Remi-managed; Stage 2 = hybrid custody (target).
8. **Scope:** one prompt, one scope. If a change outside this prompt's scope is needed, STOP and list it.
9. **Gate per phase:** `npx hardhat compile` passes, `npx hardhat test` is fully green, and `git diff --stat` is reviewed. Then one conventional commit per phase.
10. **Changed v1 tests:** if a v1 test has to change, the commit body names the SPEC decision or finding that changed it.
11. **Deviations:** if anything in the SPEC looks wrong or impossible, STOP and explain. Don't improvise.
12. **Report:** end every prompt with what changed, test counts, deployed bytecode size, and any open issues.

---

## Prompt 0 — Tag v1, create branch, save spec, sync tests, open draft PR

```
Read @remiwallet-v2-cursor-prompts.md (repo root). Follow its Part B "Standing rules".
No Solidity changes in this prompt.

Phase 0 — Inspect (no edits)
- Confirm the working tree is clean and you are on `main`. Report `git log -1`.
- If ../remi-wallet-monorepo exists locally, diff `contracts/RemiWallet.sol` against
  ../remi-wallet-monorepo/contracts/contracts/RemiWallet.sol. They must be identical. If they
  differ, STOP and report.
- Run `npx hardhat test` and report the count (expected: 40 passing).
- Check that tag `v1.0.0` does not already exist locally or on origin.

Phase 1 — Tag v1
- Create an annotated tag on the current `main` HEAD:
  git tag -a v1.0.0 -m "RemiWallet v1 — baseline before v2. Source identical to
  remi-wallet-monorepo staging@2553a4b. Hedera mainnet 0x23d1818bC9f408d62f118BcF75cfe40683dAe889
  (2026-05-13) is believed to be this source; bytecode not verified."
- Push the tag: git push origin v1.0.0

Phase 2 — Branch and docs
- git checkout -b feat/v2-hybrid-custody
- Save Part A of the root file, verbatim, as docs/v2/SPEC.md and Part B, verbatim, as
  docs/v2/PROMPTS.md. Delete the root file.
- Commit: "docs(v2): add RemiWallet v2 spec and Cursor prompt plan"

Phase 3 — Sync the fee tests from the monorepo
- Bring tests 41–54 (the "Fee system" describe block, plus the variables and constants it
  needs: feeRecipient signer, FEE_BPS, MIN_FEE, TRANSFER_AMOUNT) from
  ../remi-wallet-monorepo/contracts/test/RemiWallet.test.ts into test/RemiWallet.test.ts.
  If that path doesn't exist, STOP and ask me to paste the file.
- Expected result: 54 passing against the unchanged v1 contract.
- Commit: "test: sync fee-system tests 41–54 from monorepo"

Phase 4 — Push and draft PR
- git push -u origin feat/v2-hybrid-custody
- gh pr create --draft --base main --title "RemiWallet v2 — hybrid custody (WIP, not for deployment)"
  Body: one paragraph on the goal (SPEC §1), a link to docs/v2/SPEC.md, the prompt checklist
  (Prompts 1–8 as unchecked boxes), and the line "Do not merge before SPEC §11 is met."

DO NOT touch: contracts/, scripts/, hardhat.config.ts, abi/, deployments/, README.md.
Report: tag SHA, branch, PR URL, test count.
```

---

## Prompt 1 — Testnet spike: allowance spending from a KeyList account

```
Attach @docs/v2/SPEC.md. Follow docs/v2/PROMPTS.md "Standing rules".
Goal: prove the core design in SPEC §4 on Hedera TESTNET before any contract work.
This prompt writes a throwaway spike only. It does not change contracts/RemiWallet.sol.

Phase 0 — Inspect (no edits)
- Read .env.example and hardhat.config.ts. List which testnet env vars exist (names only).
- Look up the official IHederaTokenService.sol and HederaResponseCodes.sol. Quote the exact
  signatures of transferToken and transferFrom, and the codes for SUCCESS, insufficient balance,
  insufficient allowance and token-not-associated.
- Propose the spike plan and the dependencies it needs (expected: @hashgraph/sdk as a devDependency).
  Wait for my OK.

Phase 1 — Build the spike (spikes/allowance/)
- SpikeSpender.sol: pull(address from, address to, uint256 amount) calls precompile transferFrom
  on the testnet USDC token (0.0.8260673) and requires SUCCESS. whoami() returns msg.sender.
  allowanceOf(address owner) and balanceOf(address owner) read the ERC-20 facade.
- SpikeOwned.sol: a minimal OpenZeppelin Ownable2Step contract.
- spikes/allowance/run.ts (ethers + @hashgraph/sdk, testnet only, keys from .env, never printed):
  a. Create a 2-of-3 KeyList account U with fresh local ECDSA keys. Fund it with a little HBAR,
     associate testnet USDC, and send it a small amount of testnet USDC. If the operator has no
     testnet USDC, STOP and tell me.
  b. Deploy SpikeSpender and SpikeOwned. Associate SpikeSpender with USDC if needed.
  c. U grants SpikeSpender a USDC allowance (AccountAllowanceApproveTransaction, signed by 2 of 3).
  d. U calls whoami() with ContractExecuteTransaction, signed by 2 of 3.
  e. A plain ECDSA EOA calls pull(U, R, x) with an EVM transaction (R = any associated account).
  f. The EOA calls pull(U, R, more than the remaining allowance). It must fail; record the code.
  g. SpikeOwned.transferOwnership(U's msg.sender address), then U calls acceptOwnership() with
     ContractExecuteTransaction signed by 2 of 3.

Phase 2 — Record results in docs/v2/SPIKE-RESULTS.md, with transaction IDs:
- S1: Can a contract spend U's USDC with precompile transferFrom under an allowance U granted? (e)
- S2: Does the allowance decrease correctly, and does overspending fail with which code? (e, f)
- S3: What is msg.sender for U's ContractExecuteTransaction (long-zero address or EVM alias)? (d)
- S4: Can a KeyList account accept Ownable2Step ownership? (g)
- S5: Do facade allowance() and balanceOf() return correct values for U?
Commit: "chore(spike): verify HTS allowance spending from a KeyList account on testnet"

STOP conditions: S1 or S2 fails → stop, report, change nothing else (SPEC §4 Plan B is Remi's call).
DO NOT touch: contracts/RemiWallet.sol, test/, scripts/, abi/, deployments/.
```

---

## Prompt 2 — Test harness: HTS precompile mock

```
Attach @docs/v2/SPEC.md. Follow docs/v2/PROMPTS.md "Standing rules".
Prerequisite: docs/v2/SPIKE-RESULTS.md shows S1–S5 passed. If not, STOP.
Goal: tests can execute real transfer paths locally. No change to contract behaviour.

Phase 0 — Inspect (no edits)
- Read test/RemiWallet.test.ts. List the tests that only assert reverts because HTS can't
  run locally (e.g. 52–54, and the comment near line 193).
- Propose the mock design. Wait for my OK.

Phase 1 — Mocks (contracts/test-helpers/)
- MockHTS.sol, installed at 0x167 with hardhat_setCode. No constructor logic, because setCode
  copies runtime code only. It implements transferToken(address,address,address,int64) and
  transferFrom(address,address,address,uint256), with per-token balances, allowances and
  associations, and response codes copied from HederaResponseCodes.sol. It also has
  test-only helpers: mint, approve, setAssociated.
  Hedera behaviour to mirror (confirm against SPIKE-RESULTS.md):
  - transferToken from a contract moves the contract's own balance.
  - transferFrom spends the allowance of msg.sender (the calling contract).
- MockUsdcFacade.sol: balanceOf and allowance read MockHTS state. Use its address as usdcTokenAddress.
- test/helpers/hts.ts: a fixture that installs the mocks and funds accounts.

Phase 2 — Use the harness
- Switch the tests from FAKE_USDC to the facade.
- Add success-path tests for the v1 behaviour: a pool transfer with no fee, a transfer with a fee
  (two transfers), and a failure when the recipient isn't associated. These record v1
  behaviour before v2 changes it.
- Commit: "test: add HTS precompile mock and v1 transfer success-path tests"

DO NOT touch: contracts/RemiWallet.sol, scripts/, abi/, deployments/.
```

---

## Prompt 3 — Ownership hardening and roles

```
Attach @docs/v2/SPEC.md (§5, §7, §8). Follow docs/v2/PROMPTS.md "Standing rules".
Scope: ownership, roles, pause, immutable token, max daily limit. Do NOT change the session-key
logic, transferUsdc or fees in this prompt; they stay onlyOwner/v1 for now.

Phase 0 — Inspect and propose the exact diff (no edits). Wait for my OK.

Phase 1 — Ownership (RW-09)
- Ownable → Ownable2Step. renounceOwnership() always reverts ("RemiWallet: renounce disabled").
- usdcTokenAddress becomes immutable.
- Commit: "feat(contract): two-step ownership and disable renounce"

Phase 2 — Roles and pause
- Constructor becomes (usdc, operator_, maxDailyLimitUsdc_), validated per SPEC §7.
- Add operator (setOperator, owner), guardians (setGuardian(addr, bool), owner, isGuardian),
  maxDailyLimitUsdc (setMaxDailyLimit, owner), and OpenZeppelin Pausable:
  pause() for a guardian or the owner, unpause() for the owner only.
- createPaymentRequest, confirmPayment and failPayment become operator-only. Their logic is unchanged.
- Events: OperatorChanged, GuardianSet, MaxDailyLimitChanged, Paused/Unpaused.
- Tests: every role allowed and denied, a pending owner must accept, renounce reverts, unpause
  is owner-only. Update deployment fixtures for the new constructor.
- Update the deploy scripts' constructor arguments only (no network changes).
- Commit: "feat(contract): add operator, guardian, pause and max daily limit roles"
```

---

## Prompt 4 — Account-bound session keys and token-bucket rate limit

```
Attach @docs/v2/SPEC.md (§3, §5, §6 I2 I4 I7, §7, §8). Follow docs/v2/PROMPTS.md "Standing rules".
Scope: session-key registration, update, revoke and rate limit. transferUsdc still spends from
the contract balance in this prompt (Prompt 5 changes that) but must use the new bucket.

Phase 0 — Inspect and propose the exact diff, including the new SessionKeyConfig layout. Wait for my OK.

Phase 1 — Binding
- registerSessionKey(key, dailyLimit, expiresAt) is called by the account and binds key → msg.sender.
  Rules exactly as SPEC §7 (no rebinding; re-registration only by the same account and only if the
  key is inactive or expired; key ≠ msg.sender; limit ≤ maxDailyLimitUsdc; not paused).
- updateSessionKeyLimit: the bound account only.
- revokeSessionKey: the bound account, a guardian or the owner; never blocked by pause.
  The event records `by`.
- sessionKeyList holds each key once.
- Commit: "feat(contract): bind session keys to the registering account"

Phase 2 — Token bucket (RW-02)
- Replace the UTC-day reset with the SPEC §7 bucket (cap = min(dailyLimit, maxDailyLimit)).
- Bound every amount and limit by MAX_AMOUNT.
- getRemainingDailyLimit returns the bucket level (0 if the key is invalid or the contract is paused).
- Tests: no midnight double burst; refill over time; lowering maxDailyLimit caps live keys
  immediately; revoke + re-register doesn't refill; an expired key can be re-registered by its
  account; another account can't rebind it.
- Commit: "feat(contract): replace daily reset with token-bucket rate limit"
```

---

## Prompt 5 — Spend from the bound account (RW-01)

```
Attach @docs/v2/SPEC.md (§4, §6 I1 I3, §7) and @docs/v2/SPIKE-RESULTS.md.
Follow docs/v2/PROMPTS.md "Standing rules".
Scope: the transferUsdc funding source, and the views. Keep the v1 fee maths for now (Prompt 6 replaces it).

Phase 0 — Inspect and propose the exact diff. Confirm the transferFrom signature against SPIKE-RESULTS.md. Wait for my OK.

Phase 1
- transferUsdc pulls from the key's bound account with precompile transferFrom
  (net → `to`; fee → feeRecipient for now), in the SPEC §7 order. Reject to == address(this).
  Remove every code path that spends the contract's own balance for payments.
- Event: UsdcTransferred(sessionKey, from, to, netAmount, feeAmount, memo).
- Add getSpendableNow(key) per SPEC §7 (facade views only).
- Tests: a payment debits the bound account and its allowance; zero allowance or insufficient
  balance reverts; key A can't spend account B's funds; the operator, guardians and owner have
  no path to move account funds; to == address(this) reverts.
- Commit: "feat(contract): spend from the session key's bound account via HTS allowance"
```

---

## Prompt 6 — Fees: 5% cap and accrual (RW-06, RW-08)

```
Attach @docs/v2/SPEC.md (§6 I5 I6, §7, §9 D1). Follow docs/v2/PROMPTS.md "Standing rules".
Scope: fee maths and fee custody only.

Phase 0 — Inspect and propose the exact diff, plus the list of v1 fee tests that change and why. Wait for my OK.

Phase 1
- One private _computeFee used by transferUsdc and calculateFee, exactly per SPEC §7 and D1.
  The "waive if fee ≥ amount" branch is removed.
- The fee goes to the contract (transferFrom account → address(this)); accruedFees += fee.
  Event: FeeAccrued.
- withdrawFees(): owner or feeRecipient; zeroes accruedFees, then pays feeRecipient.
  If the payout fails, the whole transaction reverts and the fees stay.
- sweepExcess(to): owner; moves only (balance − accruedFees). Event: ExcessSwept.
- Tests: the cap holds across amounts (include 1, 19, 20, minFee-boundary and large values);
  flat-fee config; an unassociated fee recipient doesn't block payments but withdrawFees reverts
  and keeps the fees; sweepExcess can't touch accrued fees.
- Commit: "feat(contract): cap fees at 5% and accrue them for withdrawal"
```

---

## Prompt 7 — Attack replays, invariant tests, docs, size

```
Attach @docs/v2/SPEC.md (§6, §8). Follow docs/v2/PROMPTS.md "Standing rules".
Scope: tests and documentation only. No contract behaviour changes; if a test exposes a bug,
STOP and report it instead of fixing it here.

Phase 1 — Attack replays (test/RemiWallet.attacks.test.ts): one test per SPEC §8 row.
Each test states the v1 outcome in its name and asserts the v2 outcome.
Include an operator-compromise test and a guardian-compromise test (no fund movement possible).

Phase 2 — Invariant tests (test/RemiWallet.invariants.test.ts)
- Randomized sequences (seeded; print the seed on failure) of register, update, revoke, pay,
  pause, unpause, fee config, withdrawFees, sweepExcess and time travel, across 3 accounts and
  several keys. After every step, assert I1–I8.

Phase 3 — Docs and checks
- NatSpec on every external function, with custody wording per SPEC §3.
- README: a v2 section (roles table, custody stages, "not deployed"). Remove the claim that the
  owner is a 2-of-3 threshold key unless it is true for the deployed v1.
- CHANGELOG.md: v1.0.0 → v2 (unreleased).
- Run `npm run compile` so abi/ syncs. Report deployed bytecode size; it must be < 24,576 bytes.
  If it's above 22,000, propose custom errors in place of revert strings, but don't apply them.
- If Slither is installed, run it and list the findings. Don't add it as a dependency.
- Commit: "test(v2): attack replays and invariant tests" and "docs(v2): NatSpec, README and changelog"
```

---

## Prompt 8 — Testnet rehearsal (no mainnet)

```
Attach @docs/v2/SPEC.md and @docs/v2/SPIKE-RESULTS.md. Follow docs/v2/PROMPTS.md "Standing rules".
Goal: the full v2 lifecycle on Hedera TESTNET with real KeyList accounts and real HTS.

Phase 0 — Propose the script plan and the accounts it creates. Wait for my OK.

Phase 1 — scripts/v2/rehearsal.ts (testnet only; refuse to run if chainId ≠ 296)
1. Deploy v2; associate it with testnet USDC.
2. transferOwnership to a 2-of-3 KeyList owner account; accept via ContractExecuteTransaction.
3. Owner sets the operator, a guardian, maxDailyLimit and the fee config.
4. Create 2 KeyList user accounts (U1, U2). Fund and associate them. Each grants an allowance.
5. U1 registers session key K1 (account-signed). K1 pays U2; check balances, the allowance and the fee.
6. K1 tries to overspend its bucket → fails. A key bound to U2 can't spend U1's funds.
7. The guardian pauses → K1 payment fails; revoke still works; the owner unpauses.
8. withdrawFees to the fee recipient; sweepExcess after a direct stray transfer.
9. The guardian revokes K1 → K1 payment fails.

Phase 2 — docs/v2/TESTNET-REHEARSAL.md: each step, its transaction ID, expected vs actual result.
Commit: "chore(v2): testnet rehearsal script and results"

DO NOT add any mainnet network or address. Do not tag a release.
```
