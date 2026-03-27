import { expect } from "chai";
import { ethers } from "hardhat";
import { PaymentRegistry } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("PaymentRegistry", function () {
  let registry: PaymentRegistry;
  let owner: SignerWithAddress;
  let other: SignerWithAddress;

  const REQUEST_ID = ethers.id("test-request-001");
  const AMOUNT_USDC = ethers.parseUnits("100", 6);
  const EXPIRES_AT = Math.floor(Date.now() / 1000) + 86400;

  beforeEach(async function () {
    [owner, other] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("PaymentRegistry");
    registry = await Factory.deploy();
    await registry.waitForDeployment();
  });

  it("1. Deploys and sets owner correctly", async function () {
    expect(await registry.owner()).to.equal(owner.address);
  });

  describe("createPaymentRequest", function () {
    it("2. Succeeds with valid params and emits event", async function () {
      await expect(
        registry.createPaymentRequest(
          REQUEST_ID,
          other.address,
          AMOUNT_USDC,
          EXPIRES_AT
        )
      )
        .to.emit(registry, "PaymentRequestCreated")
        .withArgs(REQUEST_ID, other.address, AMOUNT_USDC, EXPIRES_AT);
    });

    it("3. Reverts if called by non-owner", async function () {
      await expect(
        registry
          .connect(other)
          .createPaymentRequest(
            REQUEST_ID,
            other.address,
            AMOUNT_USDC,
            EXPIRES_AT
          )
      ).to.be.revertedWith("Not authorized");
    });

    it("4. Reverts if requestId already exists", async function () {
      await registry.createPaymentRequest(
        REQUEST_ID,
        other.address,
        AMOUNT_USDC,
        EXPIRES_AT
      );
      await expect(
        registry.createPaymentRequest(
          REQUEST_ID,
          other.address,
          AMOUNT_USDC,
          EXPIRES_AT
        )
      ).to.be.revertedWith("Already exists");
    });

    it("5. Reverts if recipient is zero address", async function () {
      await expect(
        registry.createPaymentRequest(
          REQUEST_ID,
          ethers.ZeroAddress,
          AMOUNT_USDC,
          EXPIRES_AT
        )
      ).to.be.revertedWith("Invalid recipient");
    });
  });

  describe("confirmPayment", function () {
    const TUS_GIROS_REF = "TG-REF-123";
    const HEDERA_TX_ID = "0.0.12345@1234567890.000";

    beforeEach(async function () {
      await registry.createPaymentRequest(
        REQUEST_ID,
        other.address,
        AMOUNT_USDC,
        EXPIRES_AT
      );
    });

    it("6. Succeeds from pending state and emits event", async function () {
      await expect(
        registry.confirmPayment(REQUEST_ID, TUS_GIROS_REF, HEDERA_TX_ID)
      )
        .to.emit(registry, "PaymentConfirmed")
        .withArgs(
          REQUEST_ID,
          other.address,
          AMOUNT_USDC,
          TUS_GIROS_REF,
          HEDERA_TX_ID
        );

      const req = await registry.getRequest(REQUEST_ID);
      expect(req.status).to.equal(1); // Confirmed
      expect(req.confirmedAt).to.be.greaterThan(0);
      expect(req.tusGirosReference).to.equal(TUS_GIROS_REF);
      expect(req.hederaTxId).to.equal(HEDERA_TX_ID);
    });

    it("7. Reverts if request not found", async function () {
      const unknownId = ethers.id("unknown");
      await expect(
        registry.confirmPayment(unknownId, TUS_GIROS_REF, HEDERA_TX_ID)
      ).to.be.revertedWith("Not found");
    });

    it("8. Reverts if already confirmed", async function () {
      await registry.confirmPayment(REQUEST_ID, TUS_GIROS_REF, HEDERA_TX_ID);
      await expect(
        registry.confirmPayment(REQUEST_ID, TUS_GIROS_REF, HEDERA_TX_ID)
      ).to.be.revertedWith("Invalid status");
    });
  });

  describe("failPayment", function () {
    beforeEach(async function () {
      await registry.createPaymentRequest(
        REQUEST_ID,
        other.address,
        AMOUNT_USDC,
        EXPIRES_AT
      );
    });

    it("9. Succeeds from pending state and emits event", async function () {
      await expect(registry.failPayment(REQUEST_ID, "Timeout"))
        .to.emit(registry, "PaymentFailed")
        .withArgs(REQUEST_ID, "Timeout");

      const req = await registry.getRequest(REQUEST_ID);
      expect(req.status).to.equal(2); // Failed
    });

    it("10. Reverts if not found", async function () {
      const unknownId = ethers.id("unknown");
      await expect(
        registry.failPayment(unknownId, "Timeout")
      ).to.be.revertedWith("Not found");
    });
  });

  describe("getRequest", function () {
    it("11. Returns correct data after creation", async function () {
      await registry.createPaymentRequest(
        REQUEST_ID,
        other.address,
        AMOUNT_USDC,
        EXPIRES_AT
      );

      const req = await registry.getRequest(REQUEST_ID);
      expect(req.requestId).to.equal(REQUEST_ID);
      expect(req.recipient).to.equal(other.address);
      expect(req.amountUsdc).to.equal(AMOUNT_USDC);
      expect(req.status).to.equal(0); // Pending
      expect(req.createdAt).to.be.greaterThan(0);
      expect(req.confirmedAt).to.equal(0);
      expect(req.tusGirosReference).to.equal("");
      expect(req.hederaTxId).to.equal("");
    });
  });
});
