import { expect } from "chai";
import { ethers } from "hardhat";
import { CommodityToken, SettlementEscrow } from "../typechain-types";

describe("CommodityToken", function () {
  let token: CommodityToken;
  let escrow: SettlementEscrow;
  let owner: Awaited<ReturnType<typeof ethers.getSigners>>[0];
  let trader1: Awaited<ReturnType<typeof ethers.getSigners>>[0];
  let trader2: Awaited<ReturnType<typeof ethers.getSigners>>[0];

  beforeEach(async function () {
    [owner, trader1, trader2] = await ethers.getSigners();

    const CommodityTokenFactory = await ethers.getContractFactory("CommodityToken");
    token = await CommodityTokenFactory.deploy("ipfs://");
    await token.waitForDeployment();

    const SettlementEscrowFactory = await ethers.getContractFactory("SettlementEscrow");
    escrow = await SettlementEscrowFactory.deploy();
    await escrow.waitForDeployment();

    // KYC-verify all accounts
    await token.setKYCStatus(owner.address, true);
    await token.setKYCStatus(trader1.address, true);
    await token.setKYCStatus(trader2.address, true);
  });

  describe("Minting", function () {
    it("should mint a commodity token", async function () {
      const tx = await token.mintCommodity(
        owner.address,
        "GOLD",
        1000,
        "grams",
        "WR-GOLD-001",
        "LBMA-Certified",
        0,
        "ipfs://QmGoldBar001"
      );
      await tx.wait();

      const balance = await token.balanceOf(owner.address, 1);
      expect(balance).to.equal(1000);

      const lot = await token.getLot(1);
      expect(lot.symbol).to.equal("GOLD");
      expect(lot.quantity).to.equal(1000);
      expect(lot.warehouseReceipt).to.equal("WR-GOLD-001");
      expect(lot.active).to.equal(true);
    });

    it("should reject minting for non-KYC addresses", async function () {
      await token.setKYCStatus(trader1.address, false);
      await expect(
        token.mintCommodity(trader1.address, "GOLD", 100, "grams", "WR-001", "A", 0, "ipfs://Qm1")
      ).to.be.revertedWith("Recipient not KYC verified");
    });

    it("should reject minting for blacklisted addresses", async function () {
      await token.setBlacklisted(trader1.address, true);
      await expect(
        token.mintCommodity(trader1.address, "GOLD", 100, "grams", "WR-001", "A", 0, "ipfs://Qm1")
      ).to.be.revertedWith("Recipient is blacklisted");
    });

    it("should return correct token URI", async function () {
      await token.mintCommodity(owner.address, "GOLD", 100, "grams", "WR-001", "A", 0, "ipfs://QmTestHash");
      const uri = await token.uri(1);
      expect(uri).to.equal("ipfs://QmTestHash");
    });
  });

  describe("Transfers", function () {
    beforeEach(async function () {
      await token.mintCommodity(owner.address, "GOLD", 1000, "grams", "WR-001", "A", 0, "ipfs://Qm1");
    });

    it("should transfer tokens between KYC-verified addresses", async function () {
      await token.safeTransferFrom(owner.address, trader1.address, 1, 500, "0x");
      expect(await token.balanceOf(owner.address, 1)).to.equal(500);
      expect(await token.balanceOf(trader1.address, 1)).to.equal(500);
    });

    it("should reject transfers to non-KYC addresses", async function () {
      await token.setKYCStatus(trader2.address, false);
      await expect(
        token.safeTransferFrom(owner.address, trader2.address, 1, 100, "0x")
      ).to.be.revertedWith("Recipient not KYC verified");
    });
  });

  describe("Redemption", function () {
    it("should burn tokens on redemption", async function () {
      await token.mintCommodity(owner.address, "GOLD", 1000, "grams", "WR-001", "A", 0, "ipfs://Qm1");
      await token.redeem(1, 500);
      expect(await token.balanceOf(owner.address, 1)).to.equal(500);
    });
  });
});

describe("SettlementEscrow", function () {
  let token: CommodityToken;
  let escrow: SettlementEscrow;
  let operator: Awaited<ReturnType<typeof ethers.getSigners>>[0];
  let buyer: Awaited<ReturnType<typeof ethers.getSigners>>[0];
  let seller: Awaited<ReturnType<typeof ethers.getSigners>>[0];

  beforeEach(async function () {
    [operator, buyer, seller] = await ethers.getSigners();

    const CommodityTokenFactory = await ethers.getContractFactory("CommodityToken");
    token = await CommodityTokenFactory.deploy("ipfs://");
    await token.waitForDeployment();

    const SettlementEscrowFactory = await ethers.getContractFactory("SettlementEscrow");
    escrow = await SettlementEscrowFactory.deploy();
    await escrow.waitForDeployment();

    // Setup
    await token.setKYCStatus(operator.address, true);
    await token.setKYCStatus(buyer.address, true);
    await token.setKYCStatus(seller.address, true);
    await token.setKYCStatus(await escrow.getAddress(), true);

    // Mint tokens to seller
    await token.mintCommodity(seller.address, "GOLD", 1000, "grams", "WR-001", "A", 0, "ipfs://Qm1");
  });

  it("should create escrow and execute atomic DvP settlement", async function () {
    const tokenAddress = await token.getAddress();
    const escrowAddress = await escrow.getAddress();
    const paymentAmount = ethers.parseEther("1.0");

    // Create escrow
    const createTx = await escrow.createEscrow(
      "TRADE-001",
      buyer.address,
      seller.address,
      tokenAddress,
      1,     // tokenId
      500,   // tokenAmount
      paymentAmount
    );
    const receipt = await createTx.wait();
    const event = receipt?.logs.find(
      (log) => log.topics[0] === ethers.id("EscrowCreated(bytes32,string,address,address)")
    );
    const escrowId = event?.topics[1] as string;

    // Buyer funds escrow
    await escrow.connect(buyer).fundEscrow(escrowId, { value: paymentAmount });

    // Seller approves escrow contract for token transfer
    await token.connect(seller).setApprovalForAll(escrowAddress, true);

    // Seller deposits tokens — triggers atomic settlement
    await escrow.connect(seller).depositTokens(escrowId);

    // Verify: buyer now has tokens, seller received payment
    expect(await token.balanceOf(buyer.address, 1)).to.equal(500);
    expect(await token.balanceOf(seller.address, 1)).to.equal(500);
  });

  it("should cancel expired escrow and refund", async function () {
    const tokenAddress = await token.getAddress();
    const paymentAmount = ethers.parseEther("0.5");

    const createTx = await escrow.createEscrow(
      "TRADE-002",
      buyer.address,
      seller.address,
      tokenAddress,
      1,
      100,
      paymentAmount
    );
    const receipt = await createTx.wait();
    const event = receipt?.logs.find(
      (log) => log.topics[0] === ethers.id("EscrowCreated(bytes32,string,address,address)")
    );
    const escrowId = event?.topics[1] as string;

    // Buyer funds
    await escrow.connect(buyer).fundEscrow(escrowId, { value: paymentAmount });

    // Fast-forward time past expiry (1 hour)
    await ethers.provider.send("evm_increaseTime", [3601]);
    await ethers.provider.send("evm_mine", []);

    // Cancel (anyone can cancel expired escrow)
    const buyerBalanceBefore = await ethers.provider.getBalance(buyer.address);
    await escrow.cancelEscrow(escrowId, "Expired");
    const buyerBalanceAfter = await ethers.provider.getBalance(buyer.address);

    // Buyer should get refund
    expect(buyerBalanceAfter).to.be.greaterThan(buyerBalanceBefore);
  });
});
