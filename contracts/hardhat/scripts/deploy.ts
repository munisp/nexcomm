import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await deployer.provider.getBalance(deployer.address)).toString());

  // ── Deploy CommodityToken (ERC-1155) ──────────────────────────────────
  const baseURI = "ipfs://";
  console.log("\n1. Deploying CommodityToken (ERC-1155)...");
  const CommodityToken = await ethers.getContractFactory("CommodityToken");
  const commodityToken = await CommodityToken.deploy(baseURI);
  await commodityToken.waitForDeployment();
  const commodityTokenAddress = await commodityToken.getAddress();
  console.log("   CommodityToken deployed to:", commodityTokenAddress);

  // ── Deploy SettlementEscrow ───────────────────────────────────────────
  console.log("\n2. Deploying SettlementEscrow...");
  const SettlementEscrow = await ethers.getContractFactory("SettlementEscrow");
  const escrow = await SettlementEscrow.deploy();
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  console.log("   SettlementEscrow deployed to:", escrowAddress);

  // ── Post-deployment setup ─────────────────────────────────────────────
  console.log("\n3. Post-deployment setup...");

  // KYC-verify the deployer so they can receive tokens
  const tx1 = await commodityToken.setKYCStatus(deployer.address, true);
  await tx1.wait();
  console.log("   Deployer KYC-verified");

  // Grant SETTLEMENT_ROLE on escrow to the deployer
  const SETTLEMENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes("SETTLEMENT_ROLE"));
  const tx2 = await escrow.grantRole(SETTLEMENT_ROLE, deployer.address);
  await tx2.wait();
  console.log("   Deployer granted SETTLEMENT_ROLE on escrow");

  // ── Mint a sample commodity token ─────────────────────────────────────
  console.log("\n4. Minting sample GOLD commodity token...");
  const mintTx = await commodityToken.mintCommodity(
    deployer.address,
    "GOLD",
    ethers.parseUnits("1000", 0), // 1000 grams
    "grams",
    "WR-GOLD-001",
    "LBMA-Certified",
    0, // no expiry
    "ipfs://QmGoldBar001MetadataHash"
  );
  const mintReceipt = await mintTx.wait();
  console.log("   Minted GOLD token (tokenId: 1), tx:", mintReceipt?.hash);

  // ── Summary ───────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("NEXCOM Exchange - Contract Deployment Summary");
  console.log("=".repeat(60));
  console.log(`Network:            ${(await ethers.provider.getNetwork()).name} (chainId: ${(await ethers.provider.getNetwork()).chainId})`);
  console.log(`Deployer:           ${deployer.address}`);
  console.log(`CommodityToken:     ${commodityTokenAddress}`);
  console.log(`SettlementEscrow:   ${escrowAddress}`);
  console.log(`Sample GOLD minted: tokenId=1, quantity=1000 grams`);
  console.log("=".repeat(60));

  // Write deployment addresses to a JSON file for other services
  const fs = await import("fs");
  const deploymentInfo = {
    network: (await ethers.provider.getNetwork()).name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployer: deployer.address,
    contracts: {
      CommodityToken: commodityTokenAddress,
      SettlementEscrow: escrowAddress,
    },
    deployedAt: new Date().toISOString(),
  };

  fs.writeFileSync(
    "deployments.json",
    JSON.stringify(deploymentInfo, null, 2)
  );
  console.log("\nDeployment info saved to deployments.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
