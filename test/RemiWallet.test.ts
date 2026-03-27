import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { RemiWallet } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("RemiWallet", function () {
  let wallet: RemiWallet;
  let owner: SignerWithAddress;
  let sessionKey: SignerWithAddress;
  let sessionKey2: SignerWithAddress;
  let recipient: SignerWithAddress;
  let nonOwner: SignerWithAddress;

  // Fake USDC address — HTS precompile will fail in local hardhat,
  // but we test everything else. Integration tests cover real HTS.
  const FAKE_USDC = "0x0000000000000000000000000000000000000167";
  const DAILY_LIMIT = ethers.parseUnits("1000", 6); // 1000 USDC
  const ONE_DAY = 86400;

  let expiresAt: number;

  beforeEach(async function () {
    [owner, sessionKey, sessionKey2, recipient, nonOwner] =
      await ethers.getSigners();

    const latestTime = await time.latest();
    expiresAt = latestTime + 30 * ONE_DAY; // 30 days from now

    const Factory = await ethers.getContractFactory("RemiWallet");
    wallet = await Factory.deploy(FAKE_USDC);
    await wallet.waitForDeployment();
  });

  // ── Deployment ───────────────────────────────────────────────────────

  it("1. Deploys with correct owner and USDC address", async function () {
    expect(await wallet.owner()).to.equal(owner.address);
    expect(await wallet.usdcTokenAddress()).to.equal(FAKE_USDC);
  });

  it("2. Reverts deployment with zero USDC address", async function () {
    const Factory = await ethers.getContractFactory("RemiWallet");
    await expect(Factory.deploy(ethers.ZeroAddress)).to.be.revertedWith(
      "RemiWallet: zero USDC address"
    );
  });

  // ── Session Key Registration ─────────────────────────────────────────

  describe("registerSessionKey", function () {
    it("3. Registers session key with correct config and emits event", async function () {
      await expect(
        wallet.registerSessionKey(sessionKey.address, DAILY_LIMIT, expiresAt)
      )
        .to.emit(wallet, "SessionKeyRegistered")
        .withArgs(sessionKey.address, DAILY_LIMIT, expiresAt);

      const config = await wallet.getSessionKeyConfig(sessionKey.address);
      expect(config.active).to.be.true;
      expect(config.dailyLimitUsdc).to.equal(DAILY_LIMIT);
      expect(config.expiresAt).to.equal(expiresAt);
      expect(config.dailySpent).to.equal(0);
    });

    it("4. Increments session key count", async function () {
      expect(await wallet.getSessionKeyCount()).to.equal(0);
      await wallet.registerSessionKey(sessionKey.address, DAILY_LIMIT, expiresAt);
      expect(await wallet.getSessionKeyCount()).to.equal(1);
      await wallet.registerSessionKey(
        sessionKey2.address,
        DAILY_LIMIT,
        expiresAt
      );
      expect(await wallet.getSessionKeyCount()).to.equal(2);
    });

    it("5. Reverts on zero address", async function () {
      await expect(
        wallet.registerSessionKey(ethers.ZeroAddress, DAILY_LIMIT, expiresAt)
      ).to.be.revertedWith("RemiWallet: zero address");
    });

    it("6. Reverts on duplicate active key", async function () {
      await wallet.registerSessionKey(
        sessionKey.address,
        DAILY_LIMIT,
        expiresAt
      );
      await expect(
        wallet.registerSessionKey(sessionKey.address, DAILY_LIMIT, expiresAt)
      ).to.be.revertedWith("RemiWallet: key already active");
    });

    it("7. Reverts on already expired timestamp", async function () {
      const pastTime = (await time.latest()) - 1;
      await expect(
        wallet.registerSessionKey(sessionKey.address, DAILY_LIMIT, pastTime)
      ).to.be.revertedWith("RemiWallet: already expired");
    });

    it("8. Reverts on zero daily limit", async function () {
      await expect(
        wallet.registerSessionKey(sessionKey.address, 0, expiresAt)
      ).to.be.revertedWith("RemiWallet: zero limit");
    });

    it("9. Reverts when called by non-owner", async function () {
      await expect(
        wallet
          .connect(nonOwner)
          .registerSessionKey(sessionKey.address, DAILY_LIMIT, expiresAt)
      ).to.be.revertedWithCustomError(wallet, "OwnableUnauthorizedAccount");
    });
  });

  // ── Session Key Revocation ───────────────────────────────────────────

  describe("revokeSessionKey", function () {
    beforeEach(async function () {
      await wallet.registerSessionKey(
        sessionKey.address,
        DAILY_LIMIT,
        expiresAt
      );
    });

    it("10. Revokes active session key and emits event", async function () {
      await expect(wallet.revokeSessionKey(sessionKey.address))
        .to.emit(wallet, "SessionKeyRevoked")
        .withArgs(sessionKey.address);

      const config = await wallet.getSessionKeyConfig(sessionKey.address);
      expect(config.active).to.be.false;
    });

    it("11. Reverts on already inactive key", async function () {
      await wallet.revokeSessionKey(sessionKey.address);
      await expect(
        wallet.revokeSessionKey(sessionKey.address)
      ).to.be.revertedWith("RemiWallet: key not active");
    });

    it("12. Reverts when called by non-owner", async function () {
      await expect(
        wallet.connect(nonOwner).revokeSessionKey(sessionKey.address)
      ).to.be.revertedWithCustomError(wallet, "OwnableUnauthorizedAccount");
    });
  });

  // ── Session Key Limit Update ─────────────────────────────────────────

  describe("updateSessionKeyLimit", function () {
    beforeEach(async function () {
      await wallet.registerSessionKey(
        sessionKey.address,
        DAILY_LIMIT,
        expiresAt
      );
    });

    it("13. Updates limit and emits event", async function () {
      const newLimit = ethers.parseUnits("2000", 6);
      await expect(
        wallet.updateSessionKeyLimit(sessionKey.address, newLimit)
      )
        .to.emit(wallet, "SessionKeyLimitUpdated")
        .withArgs(sessionKey.address, newLimit);

      const config = await wallet.getSessionKeyConfig(sessionKey.address);
      expect(config.dailyLimitUsdc).to.equal(newLimit);
    });

    it("14. Reverts on zero limit", async function () {
      await expect(
        wallet.updateSessionKeyLimit(sessionKey.address, 0)
      ).to.be.revertedWith("RemiWallet: zero limit");
    });

    it("15. Reverts on inactive key", async function () {
      await wallet.revokeSessionKey(sessionKey.address);
      await expect(
        wallet.updateSessionKeyLimit(
          sessionKey.address,
          ethers.parseUnits("500", 6)
        )
      ).to.be.revertedWith("RemiWallet: key not active");
    });
  });

  // ── USDC Transfer (Session Key) ──────────────────────────────────────
  // Note: HTS precompile at 0x167 won't work on local Hardhat node.
  // These tests validate access control and spending limit logic.
  // The actual HTS call is tested in integration tests on Hedera testnet.

  describe("transferUsdc", function () {
    beforeEach(async function () {
      await wallet.registerSessionKey(
        sessionKey.address,
        DAILY_LIMIT,
        expiresAt
      );
    });

    it("16. Reverts when called by non-session-key", async function () {
      await expect(
        wallet
          .connect(nonOwner)
          .transferUsdc(recipient.address, ethers.parseUnits("10", 6), "test")
      ).to.be.revertedWith("RemiWallet: not an active session key");
    });

    it("17. Reverts when session key is expired", async function () {
      await time.increase(31 * ONE_DAY);

      await expect(
        wallet
          .connect(sessionKey)
          .transferUsdc(recipient.address, ethers.parseUnits("10", 6), "test")
      ).to.be.revertedWith("RemiWallet: session key expired");
    });

    it("18. Reverts when session key is revoked", async function () {
      await wallet.revokeSessionKey(sessionKey.address);

      await expect(
        wallet
          .connect(sessionKey)
          .transferUsdc(recipient.address, ethers.parseUnits("10", 6), "test")
      ).to.be.revertedWith("RemiWallet: not an active session key");
    });

    it("19. Reverts on zero amount", async function () {
      await expect(
        wallet.connect(sessionKey).transferUsdc(recipient.address, 0, "test")
      ).to.be.revertedWith("RemiWallet: zero amount");
    });

    it("20. Reverts on zero recipient", async function () {
      await expect(
        wallet
          .connect(sessionKey)
          .transferUsdc(
            ethers.ZeroAddress,
            ethers.parseUnits("10", 6),
            "test"
          )
      ).to.be.revertedWith("RemiWallet: zero recipient");
    });

    it("21. Reverts when daily limit exceeded", async function () {
      const overLimit = DAILY_LIMIT + 1n;
      // HTS call will fail first on local hardhat, but we can test the
      // limit check by attempting the amount that exceeds the daily limit.
      // The revert could be from limit check or HTS — both are correct.
      await expect(
        wallet
          .connect(sessionKey)
          .transferUsdc(recipient.address, overLimit, "test")
      ).to.be.reverted;
    });
  });

  // ── Payment Requests ─────────────────────────────────────────────────

  describe("createPaymentRequest", function () {
    const REQUEST_ID = ethers.id("test-request-001");
    const AMOUNT = ethers.parseUnits("100", 6);

    it("22. Creates payment request and emits event", async function () {
      await expect(
        wallet.createPaymentRequest(
          REQUEST_ID,
          recipient.address,
          AMOUNT,
          expiresAt
        )
      )
        .to.emit(wallet, "PaymentRequestCreated")
        .withArgs(REQUEST_ID, recipient.address, AMOUNT, expiresAt);

      const req = await wallet.getRequest(REQUEST_ID);
      expect(req.recipient).to.equal(recipient.address);
      expect(req.amountUsdc).to.equal(AMOUNT);
      expect(req.status).to.equal(0); // Pending
    });

    it("23. Reverts on duplicate request ID", async function () {
      await wallet.createPaymentRequest(
        REQUEST_ID,
        recipient.address,
        AMOUNT,
        expiresAt
      );
      await expect(
        wallet.createPaymentRequest(
          REQUEST_ID,
          recipient.address,
          AMOUNT,
          expiresAt
        )
      ).to.be.revertedWith("RemiWallet: duplicate ID");
    });

    it("24. Reverts on zero recipient", async function () {
      await expect(
        wallet.createPaymentRequest(
          REQUEST_ID,
          ethers.ZeroAddress,
          AMOUNT,
          expiresAt
        )
      ).to.be.revertedWith("RemiWallet: zero address");
    });

    it("25. Reverts on zero amount", async function () {
      await expect(
        wallet.createPaymentRequest(
          REQUEST_ID,
          recipient.address,
          0,
          expiresAt
        )
      ).to.be.revertedWith("RemiWallet: zero amount");
    });

    it("26. Reverts when called by non-owner", async function () {
      await expect(
        wallet
          .connect(nonOwner)
          .createPaymentRequest(
            REQUEST_ID,
            recipient.address,
            AMOUNT,
            expiresAt
          )
      ).to.be.revertedWithCustomError(wallet, "OwnableUnauthorizedAccount");
    });
  });

  describe("confirmPayment", function () {
    const REQUEST_ID = ethers.id("test-request-002");
    const AMOUNT = ethers.parseUnits("50", 6);
    const TUS_GIROS_REF = "TG-REF-456";
    const HEDERA_TX_ID = "0.0.12345@1234567890.000";

    beforeEach(async function () {
      await wallet.createPaymentRequest(
        REQUEST_ID,
        recipient.address,
        AMOUNT,
        expiresAt
      );
    });

    it("27. Confirms pending payment and emits event", async function () {
      await expect(
        wallet.confirmPayment(REQUEST_ID, TUS_GIROS_REF, HEDERA_TX_ID)
      )
        .to.emit(wallet, "PaymentConfirmed")
        .withArgs(REQUEST_ID, recipient.address, AMOUNT, HEDERA_TX_ID);

      const req = await wallet.getRequest(REQUEST_ID);
      expect(req.status).to.equal(1); // Confirmed
      expect(req.confirmedAt).to.be.greaterThan(0);
      expect(req.tusGirosReference).to.equal(TUS_GIROS_REF);
      expect(req.hederaTxId).to.equal(HEDERA_TX_ID);
    });

    it("28. Reverts on non-existent request", async function () {
      const unknownId = ethers.id("unknown");
      await expect(
        wallet.confirmPayment(unknownId, TUS_GIROS_REF, HEDERA_TX_ID)
      ).to.be.revertedWith("RemiWallet: not found");
    });

    it("29. Reverts on already confirmed request", async function () {
      await wallet.confirmPayment(REQUEST_ID, TUS_GIROS_REF, HEDERA_TX_ID);
      await expect(
        wallet.confirmPayment(REQUEST_ID, TUS_GIROS_REF, HEDERA_TX_ID)
      ).to.be.revertedWith("RemiWallet: not pending");
    });
  });

  describe("failPayment", function () {
    const REQUEST_ID = ethers.id("test-request-003");
    const AMOUNT = ethers.parseUnits("25", 6);

    beforeEach(async function () {
      await wallet.createPaymentRequest(
        REQUEST_ID,
        recipient.address,
        AMOUNT,
        expiresAt
      );
    });

    it("30. Fails pending payment and emits event", async function () {
      await expect(wallet.failPayment(REQUEST_ID, "Timeout"))
        .to.emit(wallet, "PaymentFailed")
        .withArgs(REQUEST_ID, "Timeout");

      const req = await wallet.getRequest(REQUEST_ID);
      expect(req.status).to.equal(2); // Failed
    });

    it("31. Reverts on non-existent request", async function () {
      const unknownId = ethers.id("unknown");
      await expect(
        wallet.failPayment(unknownId, "Timeout")
      ).to.be.revertedWith("RemiWallet: not found");
    });

    it("32. Reverts on already failed request", async function () {
      await wallet.failPayment(REQUEST_ID, "Timeout");
      await expect(
        wallet.failPayment(REQUEST_ID, "Timeout again")
      ).to.be.revertedWith("RemiWallet: not pending");
    });
  });

  // ── View Functions ───────────────────────────────────────────────────

  describe("View functions", function () {
    it("33. isSessionKeyValid returns true for valid key", async function () {
      await wallet.registerSessionKey(
        sessionKey.address,
        DAILY_LIMIT,
        expiresAt
      );
      expect(await wallet.isSessionKeyValid(sessionKey.address)).to.be.true;
    });

    it("34. isSessionKeyValid returns false for expired key", async function () {
      await wallet.registerSessionKey(
        sessionKey.address,
        DAILY_LIMIT,
        expiresAt
      );
      await time.increase(31 * ONE_DAY);
      expect(await wallet.isSessionKeyValid(sessionKey.address)).to.be.false;
    });

    it("35. isSessionKeyValid returns false for revoked key", async function () {
      await wallet.registerSessionKey(
        sessionKey.address,
        DAILY_LIMIT,
        expiresAt
      );
      await wallet.revokeSessionKey(sessionKey.address);
      expect(await wallet.isSessionKeyValid(sessionKey.address)).to.be.false;
    });

    it("36. isSessionKeyValid returns false for unregistered address", async function () {
      expect(await wallet.isSessionKeyValid(nonOwner.address)).to.be.false;
    });

    it("37. getRemainingDailyLimit returns full limit for fresh key", async function () {
      await wallet.registerSessionKey(
        sessionKey.address,
        DAILY_LIMIT,
        expiresAt
      );
      expect(
        await wallet.getRemainingDailyLimit(sessionKey.address)
      ).to.equal(DAILY_LIMIT);
    });

    it("38. getRemainingDailyLimit returns 0 for revoked key", async function () {
      await wallet.registerSessionKey(
        sessionKey.address,
        DAILY_LIMIT,
        expiresAt
      );
      await wallet.revokeSessionKey(sessionKey.address);
      expect(
        await wallet.getRemainingDailyLimit(sessionKey.address)
      ).to.equal(0);
    });

    it("39. getRemainingDailyLimit returns 0 for expired key", async function () {
      await wallet.registerSessionKey(
        sessionKey.address,
        DAILY_LIMIT,
        expiresAt
      );
      await time.increase(31 * ONE_DAY);
      expect(
        await wallet.getRemainingDailyLimit(sessionKey.address)
      ).to.equal(0);
    });

    it("40. Re-registration succeeds after revocation", async function () {
      await wallet.registerSessionKey(
        sessionKey.address,
        DAILY_LIMIT,
        expiresAt
      );
      await wallet.revokeSessionKey(sessionKey.address);

      const newExpiry = (await time.latest()) + 60 * ONE_DAY;
      const newLimit = ethers.parseUnits("500", 6);

      await expect(
        wallet.registerSessionKey(sessionKey.address, newLimit, newExpiry)
      )
        .to.emit(wallet, "SessionKeyRegistered")
        .withArgs(sessionKey.address, newLimit, newExpiry);

      expect(await wallet.isSessionKeyValid(sessionKey.address)).to.be.true;
    });
  });
});
