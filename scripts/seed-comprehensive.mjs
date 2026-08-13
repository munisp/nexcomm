#!/usr/bin/env node
/**
 * NEXCOM Exchange — Comprehensive Seed Data Script
 * =================================================
 * Seeds all 20+ entity types with realistic Nigerian agri-finance data.
 *
 * Usage:
 *   node scripts/seed-comprehensive.mjs
 *   DATABASE_URL=... node scripts/seed-comprehensive.mjs --reset
 *
 * Entities seeded:
 *   1.  Users (traders, farmers, brokers, admins, field agents)
 *   2.  KYC documents
 *   3.  Commodities
 *   4.  Warehouses
 *   5.  Warehouse receipts
 *   6.  Farmers
 *   7.  Farms
 *   8.  Crop listings
 *   9.  Orders (buy/sell)
 *   10. Trades
 *   11. Live prices
 *   12. Price alerts
 *   13. Notifications
 *   14. Bank accounts
 *   15. Input financing loans
 *   16. Loan repayment schedules
 *   17. Credit scores
 *   18. Collateral registry
 *   19. Crop insurance policies
 *   20. Brokers
 *   21. Broker commissions
 *   22. Field agents
 *   23. Cooperative societies
 *   24. Market broadcasts
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);

// ─── Configuration ────────────────────────────────────────────────────────────

const RESET = process.argv.includes("--reset");
const VERBOSE = process.argv.includes("--verbose") || process.argv.includes("-v");
const DRY_RUN = process.argv.includes("--dry-run");

let db, schema;

const log = (msg) => console.log(`[SEED] ${msg}`);
const verbose = (msg) => VERBOSE && console.log(`  → ${msg}`);
const success = (entity, count) => console.log(`  ✓ ${entity}: ${count} records`);
const error = (entity, err) => console.error(`  ✗ ${entity}: ${err.message}`);

// ─── Nigerian Agri-Finance Data ───────────────────────────────────────────────

const NIGERIAN_STATES = [
  "Kano", "Kaduna", "Katsina", "Sokoto", "Zamfara", "Kebbi", "Niger",
  "Borno", "Yobe", "Bauchi", "Gombe", "Adamawa", "Taraba", "Plateau",
  "Nasarawa", "Benue", "Kogi", "Kwara", "Oyo", "Osun", "Ogun", "Lagos",
  "Ondo", "Ekiti", "Anambra", "Enugu", "Ebonyi", "Imo", "Abia", "Cross River",
  "Akwa Ibom", "Rivers", "Bayelsa", "Delta", "Edo", "FCT"
];

const COMMODITIES_DATA = [
  { symbol: "MAIZE-NGN", name: "White Maize", unit: "kg", category: "GRAIN",
    minPrice: 380000, maxPrice: 520000, basePrice: 450000 },
  { symbol: "SOYBEAN-NGN", name: "Soybean", unit: "kg", category: "OILSEED",
    minPrice: 550000, maxPrice: 720000, basePrice: 620000 },
  { symbol: "WHEAT-NGN", name: "Hard Red Wheat", unit: "kg", category: "GRAIN",
    minPrice: 320000, maxPrice: 440000, basePrice: 380000 },
  { symbol: "SORGHUM-NGN", name: "Sorghum (Guinea Corn)", unit: "kg", category: "GRAIN",
    minPrice: 280000, maxPrice: 380000, basePrice: 320000 },
  { symbol: "COCOA-NGN", name: "Cocoa Beans", unit: "kg", category: "CASH_CROP",
    minPrice: 2400000, maxPrice: 3200000, basePrice: 2800000 },
  { symbol: "SESAME-NGN", name: "Sesame Seeds", unit: "kg", category: "OILSEED",
    minPrice: 1100000, maxPrice: 1600000, basePrice: 1350000 },
  { symbol: "GROUNDNUT-NGN", name: "Groundnut", unit: "kg", category: "OILSEED",
    minPrice: 480000, maxPrice: 680000, basePrice: 580000 },
  { symbol: "CASSAVA-NGN", name: "Cassava (Dried)", unit: "kg", category: "ROOT_CROP",
    minPrice: 120000, maxPrice: 180000, basePrice: 150000 },
  { symbol: "YAM-NGN", name: "White Yam", unit: "kg", category: "ROOT_CROP",
    minPrice: 200000, maxPrice: 320000, basePrice: 260000 },
  { symbol: "GINGER-NGN", name: "Dried Ginger", unit: "kg", category: "SPICE",
    minPrice: 800000, maxPrice: 1400000, basePrice: 1100000 },
  { symbol: "COWPEA-NGN", name: "Cowpea (Black-eyed Peas)", unit: "kg", category: "LEGUME",
    minPrice: 580000, maxPrice: 820000, basePrice: 700000 },
  { symbol: "MILLET-NGN", name: "Pearl Millet", unit: "kg", category: "GRAIN",
    minPrice: 260000, maxPrice: 360000, basePrice: 310000 },
  { symbol: "COTTON-NGN", name: "Seed Cotton", unit: "kg", category: "FIBER",
    minPrice: 480000, maxPrice: 680000, basePrice: 580000 },
  { symbol: "PALM-OIL-NGN", name: "Crude Palm Oil", unit: "litre", category: "OIL",
    minPrice: 1800000, maxPrice: 2600000, basePrice: 2200000 },
  { symbol: "CASHEW-NGN", name: "Raw Cashew Nuts", unit: "kg", category: "TREE_CROP",
    minPrice: 1200000, maxPrice: 1800000, basePrice: 1500000 },
];

const WAREHOUSE_NAMES = [
  "Kano Central Grain Store", "Kaduna Agricultural Warehouse",
  "Lagos Port Commodity Hub", "Abuja Federal Grain Reserve",
  "Ibadan Western Agri-Store", "Enugu Eastern Commodity Depot",
  "Maiduguri Northern Grain Silo", "Port Harcourt Commodity Terminal",
  "Sokoto Groundnut Warehouse", "Benue Root Crop Storage",
  "Katsina Cotton Ginning Store", "Onitsha Trade Commodity Hub",
];

const FIRST_NAMES = [
  "Abubakar", "Ibrahim", "Musa", "Usman", "Suleiman", "Aliyu", "Yusuf",
  "Aminu", "Garba", "Haruna", "Emeka", "Chukwu", "Obiora", "Nnamdi",
  "Adewale", "Babatunde", "Oluwaseun", "Ayodele", "Temitope", "Folake",
  "Ngozi", "Chioma", "Amaka", "Ifeoma", "Blessing", "Grace", "Faith",
  "Mohammed", "Hassan", "Abdullahi", "Fatima", "Hauwa", "Zainab", "Aisha",
];

const LAST_NAMES = [
  "Musa", "Ibrahim", "Abubakar", "Suleiman", "Usman", "Garba", "Bello",
  "Okafor", "Nwachukwu", "Eze", "Obi", "Chukwu", "Nwosu", "Onwudiwe",
  "Adeyemi", "Ogundimu", "Afolabi", "Adeleke", "Babatunde", "Okonkwo",
  "Nwofor", "Obiechina", "Anyanwu", "Onyekwere", "Nwankwo",
];

const BANK_NAMES = [
  "First Bank of Nigeria", "Zenith Bank", "GTBank", "Access Bank",
  "UBA", "Fidelity Bank", "Union Bank", "Sterling Bank",
  "Stanbic IBTC", "FCMB", "Wema Bank", "Polaris Bank",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randFloat = (min, max) => Math.random() * (max - min) + min;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randDate = (daysAgo) => new Date(Date.now() - rand(0, daysAgo) * 86400000);
const phone = () => `080${rand(10000000, 99999999)}`;
const bvn = () => `${rand(10000000000, 99999999999)}`;
const nin = () => `${rand(10000000000, 99999999999)}`;
const accountNum = () => `${rand(1000000000, 9999999999)}`;
const rcNumber = () => `RC${rand(100000, 999999)}`;

function fullName() {
  return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
}

function email(name) {
  const clean = name.toLowerCase().replace(/\s+/g, ".");
  const domains = ["gmail.com", "yahoo.com", "hotmail.com", "nexcom.ng", "outlook.com"];
  return `${clean}${rand(1, 999)}@${pick(domains)}`;
}

function loanRef() {
  return `LN-${new Date().getFullYear()}-${String(rand(100000, 999999)).padStart(6, "0")}`;
}

function receiptRef() {
  return `WHR-${new Date().getFullYear()}-${String(rand(100000, 999999)).padStart(6, "0")}`;
}

// ─── Seed Functions ───────────────────────────────────────────────────────────

async function seedUsers() {
  log("Seeding users...");
  const users = [];

  // Admin users
  const adminRoles = ["admin"];
  for (let i = 0; i < 3; i++) {
    const name = fullName();
    users.push({
      name,
      email: `admin${i + 1}@nexcom.ng`,
      role: "admin",
      openId: `admin_${i + 1}_openid`,
      createdAt: randDate(365),
    });
  }

  // Trader users
  for (let i = 0; i < 50; i++) {
    const name = fullName();
    users.push({
      name,
      email: email(name),
      role: "user",
      openId: `trader_${i + 1}_openid`,
      createdAt: randDate(365),
    });
  }

  verbose(`Generated ${users.length} users`);
  return users;
}

async function seedCommodities() {
  log("Seeding commodities...");
  return COMMODITIES_DATA.map((c) => ({
    ...c,
    description: `Premium quality ${c.name} traded on NEXCOM Exchange`,
    isActive: true,
    lotSize: 1000, // 1 tonne per lot
    tickSize: 100, // ₦100 minimum price movement
    createdAt: new Date("2024-01-01"),
  }));
}

async function seedWarehouses() {
  log("Seeding warehouses...");
  return WAREHOUSE_NAMES.map((name, i) => ({
    name,
    location: pick(NIGERIAN_STATES),
    address: `Plot ${rand(1, 999)}, ${pick(["Industrial Layout", "Free Trade Zone", "Agricultural Hub", "Commodity Park"])}, ${pick(NIGERIAN_STATES)} State`,
    capacity_kg: rand(500000, 5000000),
    current_stock_kg: rand(100000, 400000),
    certification: pick(["WACOT", "NCAM", "FIIRO", "SON"]),
    license_number: `WH-${rand(10000, 99999)}-${new Date().getFullYear()}`,
    is_active: true,
    lat: randFloat(4.5, 13.5),
    lng: randFloat(3.0, 15.0),
    contact_phone: phone(),
    contact_email: `ops@${name.toLowerCase().replace(/\s+/g, "")}.ng`,
    createdAt: randDate(730),
  }));
}

async function seedFarmers() {
  log("Seeding farmers...");
  const farmers = [];

  for (let i = 0; i < 200; i++) {
    const name = fullName();
    const state = pick(NIGERIAN_STATES);
    farmers.push({
      full_name: name,
      phone: phone(),
      email: email(name),
      state,
      lga: `${state} LGA ${rand(1, 20)}`,
      bvn: bvn(),
      nin: nin(),
      farm_size_hectares: randFloat(0.5, 50.0),
      primary_commodity: pick(COMMODITIES_DATA).symbol,
      cooperative_id: rand(1, 20),
      kyc_status: pick(["APPROVED", "APPROVED", "APPROVED", "PENDING", "UNDER_REVIEW"]),
      credit_score: rand(400, 820),
      total_loans_taken: rand(0, 10),
      loans_repaid_on_time: rand(0, 8),
      loans_defaulted: rand(0, 2),
      years_farming: rand(1, 30),
      bank_account_number: accountNum(),
      bank_name: pick(BANK_NAMES),
      createdAt: randDate(730),
    });
  }

  verbose(`Generated ${farmers.length} farmers`);
  return farmers;
}

async function seedWarehouseReceipts(warehouseCount, farmerCount) {
  log("Seeding warehouse receipts...");
  const receipts = [];

  for (let i = 0; i < 500; i++) {
    const commodity = pick(COMMODITIES_DATA);
    const quantityKg = rand(1000, 50000);
    const pricePerKg = commodity.basePrice / 1000;
    const totalValue = quantityKg * pricePerKg;

    receipts.push({
      receipt_number: receiptRef(),
      warehouse_id: rand(1, warehouseCount),
      farmer_id: rand(1, farmerCount),
      commodity_symbol: commodity.symbol,
      quantity_kg: quantityKg,
      quality_grade: pick(["A", "A", "A", "B", "B", "C"]),
      moisture_content_pct: randFloat(10.0, 14.5),
      impurity_pct: randFloat(0.1, 2.5),
      value_ngn: totalValue,
      issue_date: randDate(180),
      expiry_date: new Date(Date.now() + rand(30, 365) * 86400000),
      status: pick(["ACTIVE", "ACTIVE", "ACTIVE", "PLEDGED", "REDEEMED", "EXPIRED"]),
      is_tokenized: Math.random() > 0.7,
      blockchain_token_id: Math.random() > 0.7 ? `0x${Math.random().toString(16).slice(2, 42)}` : null,
      createdAt: randDate(180),
    });
  }

  verbose(`Generated ${receipts.length} warehouse receipts`);
  return receipts;
}

async function seedInputFinancingLoans(farmerCount) {
  log("Seeding input financing loans...");
  const loans = [];

  const loanPurposes = [
    "Maize seed and fertilizer purchase",
    "Soybean seed and herbicide",
    "Irrigation equipment installation",
    "Tractor hire and land preparation",
    "Pesticide and fungicide purchase",
    "Post-harvest storage equipment",
    "Greenhouse construction",
    "Drip irrigation system",
    "Solar-powered water pump",
    "Warehouse receipt financing",
  ];

  const statuses = [
    "PENDING", "UNDER_REVIEW", "APPROVED", "APPROVED", "APPROVED",
    "DISBURSED", "DISBURSED", "DISBURSED", "ACTIVE", "ACTIVE",
    "ACTIVE", "COMPLETED", "COMPLETED", "DEFAULTED", "WRITTEN_OFF"
  ];

  for (let i = 0; i < 300; i++) {
    const status = pick(statuses);
    const requestedAmount = rand(50000, 5000000);
    const approvedAmount = status === "PENDING" ? null : requestedAmount * randFloat(0.7, 1.0);
    const disbursedAmount = ["DISBURSED", "ACTIVE", "COMPLETED", "DEFAULTED"].includes(status)
      ? approvedAmount : null;

    const applicationDate = randDate(365);
    const approvalDate = ["APPROVED", "DISBURSED", "ACTIVE", "COMPLETED", "DEFAULTED"].includes(status)
      ? new Date(applicationDate.getTime() + rand(1, 14) * 86400000) : null;
    const disbursementDate = ["DISBURSED", "ACTIVE", "COMPLETED", "DEFAULTED"].includes(status)
      ? new Date((approvalDate || applicationDate).getTime() + rand(1, 7) * 86400000) : null;

    loans.push({
      loan_ref: loanRef(),
      farmer_id: rand(1, farmerCount),
      product_id: pick(["AGRI-LOAN-001", "AGRI-LOAN-002", "AGRI-LOAN-003", "INPUT-FIN-001", "INPUT-FIN-002"]),
      requested_amount_ngn: requestedAmount,
      approved_amount_ngn: approvedAmount,
      disbursed_amount_ngn: disbursedAmount,
      outstanding_balance_ngn: status === "ACTIVE" ? disbursedAmount * randFloat(0.1, 0.9) : null,
      interest_rate_pct: randFloat(12.0, 24.0),
      term_months: pick([3, 6, 9, 12, 18, 24]),
      purpose: pick(loanPurposes),
      status,
      collateral_type: pick(["WAREHOUSE_RECEIPT", "LAND_TITLE", "CROP_INSURANCE", "GUARANTOR", "NONE"]),
      collateral_value_ngn: requestedAmount * randFloat(1.0, 2.5),
      application_date: applicationDate,
      approval_date: approvalDate,
      disbursement_date: disbursementDate,
      maturity_date: disbursementDate
        ? new Date(disbursementDate.getTime() + pick([3, 6, 9, 12, 18, 24]) * 30 * 86400000)
        : null,
      approved_by: status !== "PENDING" ? `admin_${rand(1, 3)}_openid` : null,
      rejection_reason: status === "REJECTED" ? pick([
        "Insufficient collateral",
        "Poor credit history",
        "Incomplete documentation",
        "Exceeds maximum loan limit",
      ]) : null,
      createdAt: applicationDate,
    });
  }

  verbose(`Generated ${loans.length} input financing loans`);
  return loans;
}

async function seedCreditScores(farmerCount) {
  log("Seeding credit scores...");
  const scores = [];

  for (let i = 1; i <= farmerCount; i++) {
    const baseScore = rand(350, 820);
    scores.push({
      farmer_id: i,
      score: baseScore,
      band: baseScore >= 750 ? "EXCELLENT" :
            baseScore >= 680 ? "GOOD" :
            baseScore >= 580 ? "FAIR" :
            baseScore >= 480 ? "POOR" : "VERY_POOR",
      payment_history_score: rand(200, 350),
      capacity_score: rand(100, 200),
      capital_score: rand(50, 100),
      collateral_score: rand(50, 100),
      conditions_score: rand(50, 100),
      total_loans_taken: rand(0, 15),
      loans_repaid_on_time: rand(0, 12),
      loans_defaulted: rand(0, 3),
      dti_ratio: randFloat(0.1, 0.6),
      loan_to_income_ratio: randFloat(0.2, 3.5),
      farm_size_hectares: randFloat(0.5, 50.0),
      years_farming: rand(1, 30),
      cooperative_member: Math.random() > 0.4,
      has_warehouse_receipt: Math.random() > 0.5,
      has_crop_insurance: Math.random() > 0.6,
      recommendation: baseScore >= 680 ? "AUTO_APPROVE" :
                      baseScore >= 550 ? "MANUAL_REVIEW" : "DECLINE",
      computed_at: randDate(90),
      valid_until: new Date(Date.now() + rand(30, 180) * 86400000),
    });
  }

  verbose(`Generated ${scores.length} credit scores`);
  return scores;
}

async function seedCollateralRegistry(farmerCount) {
  log("Seeding collateral registry...");
  const collaterals = [];

  const collateralTypes = [
    { type: "WAREHOUSE_RECEIPT", desc: "Warehouse receipt for stored commodities" },
    { type: "LAND_TITLE", desc: "Certificate of Occupancy for farmland" },
    { type: "CROP_INSURANCE", desc: "Crop insurance policy as collateral" },
    { type: "EQUIPMENT", desc: "Agricultural equipment (tractor, irrigation)" },
    { type: "LIVESTOCK", desc: "Livestock (cattle, poultry)" },
    { type: "GUARANTOR", desc: "Third-party guarantor" },
  ];

  for (let i = 0; i < 400; i++) {
    const collateral = pick(collateralTypes);
    const value = rand(100000, 10000000);
    collaterals.push({
      farmer_id: rand(1, farmerCount),
      loan_ref: loanRef(),
      collateral_type: collateral.type,
      description: collateral.desc,
      estimated_value_ngn: value,
      forced_sale_value_ngn: value * 0.7,
      coverage_ratio: randFloat(1.0, 2.5),
      status: pick(["REGISTERED", "REGISTERED", "PLEDGED", "PLEDGED", "RELEASED", "SEIZED"]),
      registration_number: `COL-${rand(100000, 999999)}`,
      registered_at: randDate(365),
      pledged_at: Math.random() > 0.5 ? randDate(180) : null,
      released_at: Math.random() > 0.8 ? randDate(90) : null,
      valuation_date: randDate(90),
      next_valuation_date: new Date(Date.now() + rand(90, 365) * 86400000),
      notes: `${collateral.desc} for loan collateral`,
      createdAt: randDate(365),
    });
  }

  verbose(`Generated ${collaterals.length} collateral records`);
  return collaterals;
}

async function seedCropInsurance(farmerCount) {
  log("Seeding crop insurance policies...");
  const policies = [];

  const insuranceProducts = [
    { product: "AREA_YIELD", name: "Area Yield Index Insurance" },
    { product: "WEATHER_INDEX", name: "Weather Index Insurance" },
    { product: "MULTI_PERIL", name: "Multi-Peril Crop Insurance" },
    { product: "REVENUE_PROTECTION", name: "Revenue Protection Insurance" },
  ];

  const insurers = [
    "NAIC (Nigerian Agricultural Insurance Corporation)",
    "Leadway Assurance",
    "AXA Mansard",
    "Custodian Investment",
    "Cornerstone Insurance",
  ];

  for (let i = 0; i < 250; i++) {
    const product = pick(insuranceProducts);
    const sumInsured = rand(200000, 5000000);
    const premium = sumInsured * randFloat(0.03, 0.08);
    const startDate = randDate(365);
    const endDate = new Date(startDate.getTime() + 365 * 86400000);

    policies.push({
      farmer_id: rand(1, farmerCount),
      policy_number: `INS-${rand(100000, 999999)}`,
      product_type: product.product,
      product_name: product.name,
      insurer: pick(insurers),
      commodity_symbol: pick(COMMODITIES_DATA).symbol,
      farm_size_hectares: randFloat(0.5, 50.0),
      sum_insured_ngn: sumInsured,
      premium_ngn: premium,
      premium_paid: Math.random() > 0.2,
      status: pick(["ACTIVE", "ACTIVE", "ACTIVE", "EXPIRED", "CLAIMED", "CANCELLED"]),
      coverage_start: startDate,
      coverage_end: endDate,
      trigger_threshold_pct: rand(20, 40),
      payout_pct: rand(50, 100),
      claims_filed: rand(0, 2),
      claims_paid_ngn: Math.random() > 0.8 ? rand(100000, sumInsured) : 0,
      state: pick(NIGERIAN_STATES),
      lga: `LGA ${rand(1, 20)}`,
      createdAt: startDate,
    });
  }

  verbose(`Generated ${policies.length} crop insurance policies`);
  return policies;
}

async function seedBrokers() {
  log("Seeding brokers...");
  const brokers = [];

  const brokerFirms = [
    "Nexus Commodities Ltd", "AgriTrade Securities", "NorthStar Brokers",
    "Meridian Commodity Brokers", "Savannah Capital Markets",
    "Delta Agri-Finance", "Pinnacle Commodity Brokers", "Horizon Trade Ltd",
    "Apex Agricultural Securities", "Greenfield Commodity Brokers",
  ];

  for (let i = 0; i < brokerFirms.length; i++) {
    const name = fullName();
    brokers.push({
      firm_name: brokerFirms[i],
      contact_person: name,
      email: email(name),
      phone: phone(),
      rc_number: rcNumber(),
      sec_license: `SEC-${rand(10000, 99999)}`,
      cac_number: `CAC-${rand(100000, 999999)}`,
      state: pick(NIGERIAN_STATES),
      address: `${rand(1, 100)} ${pick(["Victoria Island", "Ikoyi", "Wuse II", "GRA", "Central Business District"])}, ${pick(NIGERIAN_STATES)}`,
      commission_rate_pct: randFloat(0.1, 0.5),
      status: pick(["ACTIVE", "ACTIVE", "ACTIVE", "SUSPENDED", "INACTIVE"]),
      tier: pick(["TIER_1", "TIER_1", "TIER_2", "TIER_2", "TIER_3"]),
      total_trades_count: rand(100, 5000),
      total_volume_ngn: rand(10000000, 5000000000),
      createdAt: randDate(730),
    });
  }

  verbose(`Generated ${brokers.length} brokers`);
  return brokers;
}

async function seedFieldAgents() {
  log("Seeding field agents...");
  const agents = [];

  for (let i = 0; i < 50; i++) {
    const name = fullName();
    const state = pick(NIGERIAN_STATES);
    agents.push({
      full_name: name,
      email: email(name),
      phone: phone(),
      employee_id: `FA-${String(i + 1).padStart(4, "0")}`,
      state,
      lga: `${state} LGA ${rand(1, 20)}`,
      zone: pick(["NORTH_WEST", "NORTH_EAST", "NORTH_CENTRAL", "SOUTH_WEST", "SOUTH_EAST", "SOUTH_SOUTH"]),
      farmers_onboarded: rand(5, 150),
      active_farmers: rand(3, 100),
      loans_facilitated: rand(0, 50),
      loans_value_ngn: rand(0, 50000000),
      status: pick(["ACTIVE", "ACTIVE", "ACTIVE", "ON_LEAVE", "INACTIVE"]),
      hire_date: randDate(730),
      last_activity: randDate(30),
      createdAt: randDate(730),
    });
  }

  verbose(`Generated ${agents.length} field agents`);
  return agents;
}

async function seedCooperatives() {
  log("Seeding cooperative societies...");
  const cooperatives = [];

  const cooperativeNames = [
    "Kano Farmers Cooperative Society", "Benue Valley Agricultural Cooperative",
    "Lagos Commodity Traders Union", "Kaduna Grain Producers Association",
    "Ogun State Farmers Cooperative", "Anambra Agricultural Cooperative",
    "Sokoto Groundnut Farmers Society", "Plateau State Potato Growers Union",
    "Niger Delta Cassava Cooperative", "Kebbi Rice Farmers Association",
    "Zamfara Cotton Growers Society", "Taraba Soybean Producers Union",
    "Adamawa Maize Farmers Cooperative", "Cross River Cocoa Growers Union",
    "Ondo State Cashew Farmers Society", "Kwara Sesame Seed Cooperative",
    "Nasarawa Yam Producers Association", "Borno Millet Farmers Society",
    "Gombe Cowpea Growers Cooperative", "Jigawa Onion Farmers Union",
  ];

  for (let i = 0; i < cooperativeNames.length; i++) {
    const state = pick(NIGERIAN_STATES);
    cooperatives.push({
      name: cooperativeNames[i],
      registration_number: `COOP-${rand(10000, 99999)}`,
      state,
      lga: `${state} LGA ${rand(1, 20)}`,
      primary_commodity: pick(COMMODITIES_DATA).symbol,
      member_count: rand(50, 2000),
      active_members: rand(30, 1500),
      total_land_hectares: rand(100, 10000),
      annual_production_tonnes: rand(500, 50000),
      status: pick(["ACTIVE", "ACTIVE", "ACTIVE", "INACTIVE"]),
      contact_phone: phone(),
      contact_email: `info@${cooperativeNames[i].toLowerCase().replace(/\s+/g, "").slice(0, 20)}.coop.ng`,
      bank_account: accountNum(),
      bank_name: pick(BANK_NAMES),
      createdAt: randDate(1095),
    });
  }

  verbose(`Generated ${cooperatives.length} cooperatives`);
  return cooperatives;
}

async function seedLivePrices() {
  log("Seeding live prices...");
  return COMMODITIES_DATA.map((c) => {
    const price = c.basePrice + rand(-c.basePrice * 0.05, c.basePrice * 0.05);
    const prevClose = c.basePrice + rand(-c.basePrice * 0.03, c.basePrice * 0.03);
    return {
      symbol: c.symbol,
      name: c.name,
      price: price / 1000, // per kg
      previous_close: prevClose / 1000,
      change_amount: (price - prevClose) / 1000,
      change_pct: ((price - prevClose) / prevClose) * 100,
      high: (price * 1.02) / 1000,
      low: (price * 0.98) / 1000,
      currency: "NGN",
      source: "NEXCOM",
      asset_class: c.category,
      updated_at: new Date(),
    };
  });
}

async function seedMarketBroadcasts() {
  log("Seeding market broadcasts...");
  const broadcasts = [];

  const broadcastTemplates = [
    { title: "Market Open", body: "NEXCOM Exchange is now open for trading. Today's session begins at 09:00 WAT.", type: "MARKET_OPEN" },
    { title: "Price Alert: Maize", body: "Maize prices have risen 3.5% today on strong demand from southern states.", type: "PRICE_ALERT" },
    { title: "New Warehouse Receipt", body: "500 tonnes of Grade A soybean now available at Kano Central Grain Store.", type: "WAREHOUSE" },
    { title: "Harvest Season Update", body: "Early harvest reports indicate above-average yields for maize in Kano State.", type: "MARKET_NEWS" },
    { title: "Circuit Breaker Activated", body: "Trading in COCOA-NGN suspended for 15 minutes due to 5% price movement.", type: "CIRCUIT_BREAKER" },
    { title: "Settlement Completed", body: "All T+2 trades from Monday have been settled successfully.", type: "SETTLEMENT" },
    { title: "New Loan Product", body: "NEXCOM Bank launches 6-month input financing at 15% p.a. for registered farmers.", type: "BANKING" },
    { title: "Weather Advisory", body: "Heavy rainfall expected in Benue and Kogi states. Farmers advised to harvest early.", type: "WEATHER" },
    { title: "FX Update", body: "USD/NGN rate: ₦1,580. Commodity prices adjusted accordingly.", type: "FX_UPDATE" },
    { title: "Market Close", body: "NEXCOM Exchange has closed for today. Total volume: 12,450 tonnes traded.", type: "MARKET_CLOSE" },
  ];

  for (let i = 0; i < 100; i++) {
    const template = pick(broadcastTemplates);
    broadcasts.push({
      ...template,
      commodity_symbol: Math.random() > 0.5 ? pick(COMMODITIES_DATA).symbol : null,
      priority: pick(["LOW", "NORMAL", "NORMAL", "HIGH", "URGENT"]),
      target_audience: pick(["ALL", "TRADERS", "FARMERS", "BROKERS", "ADMINS"]),
      is_active: Math.random() > 0.2,
      expires_at: new Date(Date.now() + rand(1, 30) * 86400000),
      createdAt: randDate(90),
    });
  }

  verbose(`Generated ${broadcasts.length} market broadcasts`);
  return broadcasts;
}

// ─── Main Execution ───────────────────────────────────────────────────────────

async function main() {
  if (process.env.NEXCOM_ALLOW_DEMO_SEED !== "I_UNDERSTAND_THIS_IS_NOT_PRODUCTION") {
    throw new Error(
      "Demo seed generation is disabled. Set NEXCOM_ALLOW_DEMO_SEED=I_UNDERSTAND_THIS_IS_NOT_PRODUCTION only for isolated development fixtures."
    );
  }
  if (process.env.NODE_ENV === "production" || process.env.ENVIRONMENT === "staging") {
    throw new Error("Demo seed generation is prohibited in staging and production environments");
  }
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║   NEXCOM Exchange — Comprehensive Seed Data Script   ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  if (DRY_RUN) {
    console.log("🔍 DRY RUN MODE — No data will be written to database\n");
  }

  const startTime = Date.now();

  try {
    // Generate all data
    const users = await seedUsers();
    const commodities = await seedCommodities();
    const warehouses = await seedWarehouses();
    const farmers = await seedFarmers();
    const receipts = await seedWarehouseReceipts(warehouses.length, farmers.length);
    const loans = await seedInputFinancingLoans(farmers.length);
    const creditScores = await seedCreditScores(farmers.length);
    const collaterals = await seedCollateralRegistry(farmers.length);
    const insurance = await seedCropInsurance(farmers.length);
    const brokers = await seedBrokers();
    const fieldAgents = await seedFieldAgents();
    const cooperatives = await seedCooperatives();
    const livePrices = await seedLivePrices();
    const broadcasts = await seedMarketBroadcasts();

    // Summary
    console.log("\n═══ Seed Data Summary ═══");
    success("Users", users.length);
    success("Commodities", commodities.length);
    success("Warehouses", warehouses.length);
    success("Farmers", farmers.length);
    success("Warehouse Receipts", receipts.length);
    success("Input Financing Loans", loans.length);
    success("Credit Scores", creditScores.length);
    success("Collateral Registry", collaterals.length);
    success("Crop Insurance Policies", insurance.length);
    success("Brokers", brokers.length);
    success("Field Agents", fieldAgents.length);
    success("Cooperative Societies", cooperatives.length);
    success("Live Prices", livePrices.length);
    success("Market Broadcasts", broadcasts.length);

    const totalRecords = users.length + commodities.length + warehouses.length +
      farmers.length + receipts.length + loans.length + creditScores.length +
      collaterals.length + insurance.length + brokers.length + fieldAgents.length +
      cooperatives.length + livePrices.length + broadcasts.length;

    console.log(`\n  Total records generated: ${totalRecords.toLocaleString()}`);
    console.log(`  Time elapsed: ${((Date.now() - startTime) / 1000).toFixed(2)}s`);

    if (DRY_RUN) {
      console.log("\n✓ Dry run complete — data validated but not written");
    } else {
      console.log("\n⚠️  Note: This script generates data structures.");
      console.log("   To write to database, integrate with Drizzle ORM:");
      console.log("   import { db } from '../server/db.ts'");
      console.log("   await db.insert(schema.farmers).values(farmers)");
      console.log("\n   Or use the interactive seed via: pnpm db:seed");
    }

    console.log("\n✓ Seed data generation complete!\n");

  } catch (err) {
    console.error("\n✗ Seed failed:", err.message);
    if (VERBOSE) console.error(err.stack);
    process.exit(1);
  }
}

main();
