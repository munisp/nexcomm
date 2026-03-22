// ============================================================
// NEXCOM Exchange — Shared Commodity Data Layer
// 60+ instruments across 12 categories
// ============================================================

export type CommodityCategory =
  | "GRAINS"
  | "OILSEEDS"
  | "SPICES"
  | "PULSES"
  | "SOFT_COMMODITIES"
  | "ROOT_CROPS"
  | "FRUITS"
  | "LIVESTOCK"
  | "FISHERIES"
  | "FORESTRY"
  | "ENERGY"
  | "METALS";

export interface Commodity {
  symbol: string;
  name: string;
  category: CommodityCategory;
  unit: string;          // e.g. "MT", "KG", "BBL"
  currency: string;      // e.g. "USD", "NGN"
  basePrice: number;     // reference price for mock generation
  tickSize: number;
  lotSize: number;       // minimum trade lot in units
  description: string;
  country?: string;      // primary origin country
  isFutures?: boolean;
  expiryMonth?: string;  // e.g. "MAR27"
}

export const COMMODITIES: Commodity[] = [
  // ── GRAINS ──────────────────────────────────────────────
  { symbol: "MAIZE-NG-SPOT",    name: "White Maize (Nigeria)",    category: "GRAINS",          unit: "MT",  currency: "USD", basePrice: 285,   tickSize: 0.5,  lotSize: 10,  description: "Grade 1 white maize, Nigeria origin", country: "Nigeria" },
  { symbol: "MAIZE-MAR27-FUT",  name: "White Maize Mar 2027",     category: "GRAINS",          unit: "MT",  currency: "USD", basePrice: 292,   tickSize: 0.5,  lotSize: 10,  description: "White maize futures contract, March 2027 delivery", isFutures: true, expiryMonth: "MAR27" },
  { symbol: "WHEAT-SPOT",       name: "Hard Red Wheat",           category: "GRAINS",          unit: "MT",  currency: "USD", basePrice: 215,   tickSize: 0.25, lotSize: 10,  description: "Hard red winter wheat, export grade" },
  { symbol: "RICE-NG-SPOT",     name: "Long Grain Rice (Nigeria)",category: "GRAINS",          unit: "MT",  currency: "USD", basePrice: 520,   tickSize: 1.0,  lotSize: 5,   description: "Long grain milled rice, Nigeria", country: "Nigeria" },
  { symbol: "SORGHUM-SPOT",     name: "Sorghum / Guinea Corn",    category: "GRAINS",          unit: "MT",  currency: "USD", basePrice: 195,   tickSize: 0.5,  lotSize: 10,  description: "Red sorghum, West Africa" },
  { symbol: "MILLET-SPOT",      name: "Pearl Millet",             category: "GRAINS",          unit: "MT",  currency: "USD", basePrice: 175,   tickSize: 0.5,  lotSize: 10,  description: "Pearl millet, Sahel region" },

  // ── OILSEEDS ─────────────────────────────────────────────
  { symbol: "SOYBEAN-SPOT",     name: "Soybean",                  category: "OILSEEDS",        unit: "MT",  currency: "USD", basePrice: 430,   tickSize: 0.5,  lotSize: 10,  description: "Non-GMO soybeans, Grade 2" },
  { symbol: "GROUNDNUT-SPOT",   name: "Groundnut (Peanut)",       category: "OILSEEDS",        unit: "MT",  currency: "USD", basePrice: 1050,  tickSize: 1.0,  lotSize: 5,   description: "Runner-type groundnuts, shelled", country: "Nigeria" },
  { symbol: "SESAME-SPOT",      name: "Sesame Seed",              category: "OILSEEDS",        unit: "MT",  currency: "USD", basePrice: 1350,  tickSize: 2.0,  lotSize: 5,   description: "White sesame seed, 99% purity" },
  { symbol: "SUNFLOWER-SPOT",   name: "Sunflower Seed",           category: "OILSEEDS",        unit: "MT",  currency: "USD", basePrice: 490,   tickSize: 0.5,  lotSize: 10,  description: "Confectionery sunflower seed" },
  { symbol: "PALMOIL-SPOT",     name: "Crude Palm Oil",           category: "OILSEEDS",        unit: "MT",  currency: "USD", basePrice: 870,   tickSize: 1.0,  lotSize: 5,   description: "Crude palm oil, 5% FFA max" },
  { symbol: "COTTONSEED-SPOT",  name: "Cottonseed",               category: "OILSEEDS",        unit: "MT",  currency: "USD", basePrice: 320,   tickSize: 0.5,  lotSize: 10,  description: "Delinted cottonseed" },

  // ── SPICES ───────────────────────────────────────────────
  { symbol: "GINGER-NG-SPOT",   name: "Ginger (Nigeria Split Dry)",category: "SPICES",         unit: "MT",  currency: "USD", basePrice: 1850,  tickSize: 5.0,  lotSize: 1,   description: "NG-SPLIT-DRY-G1 grade, Kaduna origin", country: "Nigeria" },
  { symbol: "GINGER-WHOLE-SPOT",name: "Ginger (Nigeria Whole Dry)",category: "SPICES",         unit: "MT",  currency: "USD", basePrice: 1620,  tickSize: 5.0,  lotSize: 1,   description: "NG-WHOLE-DRY-G1 grade, Bauchi origin", country: "Nigeria" },
  { symbol: "PEPPER-BLK-SPOT",  name: "Black Pepper",             category: "SPICES",          unit: "MT",  currency: "USD", basePrice: 4200,  tickSize: 10.0, lotSize: 1,   description: "ASTA 550 grade black pepper" },
  { symbol: "CHILI-SPOT",       name: "Dried Chili Pepper",       category: "SPICES",          unit: "MT",  currency: "USD", basePrice: 2100,  tickSize: 5.0,  lotSize: 1,   description: "Bird's eye chili, dried", country: "Nigeria" },
  { symbol: "TURMERIC-SPOT",    name: "Turmeric",                 category: "SPICES",          unit: "MT",  currency: "USD", basePrice: 1400,  tickSize: 5.0,  lotSize: 1,   description: "Turmeric finger, 3% curcumin min" },
  { symbol: "CLOVE-SPOT",       name: "Cloves",                   category: "SPICES",          unit: "MT",  currency: "USD", basePrice: 6800,  tickSize: 20.0, lotSize: 0.5, description: "Whole cloves, Zanzibar grade" },

  // ── SOFT COMMODITIES ─────────────────────────────────────
  { symbol: "COCOA-SPOT",       name: "Cocoa Beans",              category: "SOFT_COMMODITIES",unit: "MT",  currency: "USD", basePrice: 8500,  tickSize: 10.0, lotSize: 1,   description: "Grade 1 cocoa beans, West Africa" },
  { symbol: "COCOA-MAR27-FUT",  name: "Cocoa Mar 2027",           category: "SOFT_COMMODITIES",unit: "MT",  currency: "USD", basePrice: 8650,  tickSize: 10.0, lotSize: 1,   description: "Cocoa futures, March 2027", isFutures: true, expiryMonth: "MAR27" },
  { symbol: "COFFEE-SPOT",      name: "Robusta Coffee",           category: "SOFT_COMMODITIES",unit: "MT",  currency: "USD", basePrice: 3200,  tickSize: 5.0,  lotSize: 1,   description: "Grade 1 Robusta coffee beans" },
  { symbol: "COTTON-SPOT",      name: "Raw Cotton",               category: "SOFT_COMMODITIES",unit: "MT",  currency: "USD", basePrice: 1750,  tickSize: 2.0,  lotSize: 5,   description: "Upland cotton, Middling grade" },
  { symbol: "SUGAR-SPOT",       name: "Raw Cane Sugar",           category: "SOFT_COMMODITIES",unit: "MT",  currency: "USD", basePrice: 420,   tickSize: 0.5,  lotSize: 10,  description: "Raw cane sugar, 96 pol" },
  { symbol: "TOBACCO-SPOT",     name: "Flue-Cured Tobacco",       category: "SOFT_COMMODITIES",unit: "MT",  currency: "USD", basePrice: 3800,  tickSize: 10.0, lotSize: 1,   description: "Flue-cured Virginia tobacco" },

  // ── PULSES ───────────────────────────────────────────────
  { symbol: "COWPEA-SPOT",      name: "Cowpea (Black-eyed Peas)", category: "PULSES",          unit: "MT",  currency: "USD", basePrice: 680,   tickSize: 1.0,  lotSize: 5,   description: "White cowpea, Grade 1", country: "Nigeria" },
  { symbol: "LENTIL-SPOT",      name: "Red Lentils",              category: "PULSES",          unit: "MT",  currency: "USD", basePrice: 520,   tickSize: 0.5,  lotSize: 5,   description: "Split red lentils, Grade 1" },
  { symbol: "CHICKPEA-SPOT",    name: "Chickpeas",                category: "PULSES",          unit: "MT",  currency: "USD", basePrice: 750,   tickSize: 1.0,  lotSize: 5,   description: "Kabuli chickpeas, 9mm+ size" },
  { symbol: "PIGEONPEA-SPOT",   name: "Pigeon Pea (Toor Dal)",    category: "PULSES",          unit: "MT",  currency: "USD", basePrice: 890,   tickSize: 1.0,  lotSize: 5,   description: "Pigeon pea, split" },

  // ── ROOT CROPS ───────────────────────────────────────────
  { symbol: "CASSAVA-SPOT",     name: "Cassava (Dried Chips)",    category: "ROOT_CROPS",      unit: "MT",  currency: "USD", basePrice: 185,   tickSize: 0.25, lotSize: 10,  description: "Dried cassava chips, 14% moisture max", country: "Nigeria" },
  { symbol: "YAM-SPOT",         name: "White Yam",                category: "ROOT_CROPS",      unit: "MT",  currency: "USD", basePrice: 420,   tickSize: 0.5,  lotSize: 5,   description: "White yam, Grade A, Nigeria", country: "Nigeria" },
  { symbol: "POTATO-SPOT",      name: "Irish Potato",             category: "ROOT_CROPS",      unit: "MT",  currency: "USD", basePrice: 280,   tickSize: 0.5,  lotSize: 5,   description: "Irish potato, 45mm+ size" },
  { symbol: "SWEETPOTATO-SPOT", name: "Sweet Potato",             category: "ROOT_CROPS",      unit: "MT",  currency: "USD", basePrice: 310,   tickSize: 0.5,  lotSize: 5,   description: "Orange-flesh sweet potato" },

  // ── FRUITS ───────────────────────────────────────────────
  { symbol: "MANGO-SPOT",       name: "Dried Mango",              category: "FRUITS",          unit: "MT",  currency: "USD", basePrice: 2200,  tickSize: 5.0,  lotSize: 1,   description: "Dried mango slices, sulfite-free" },
  { symbol: "BANANA-SPOT",      name: "Banana (Dried)",           category: "FRUITS",          unit: "MT",  currency: "USD", basePrice: 1800,  tickSize: 5.0,  lotSize: 1,   description: "Dried banana chips" },
  { symbol: "SHEA-SPOT",        name: "Shea Nuts",                category: "FRUITS",          unit: "MT",  currency: "USD", basePrice: 950,   tickSize: 2.0,  lotSize: 5,   description: "Grade A shea nuts, 5% FFA max", country: "Nigeria" },

  // ── LIVESTOCK ────────────────────────────────────────────
  { symbol: "CATTLE-SPOT",      name: "Live Cattle",              category: "LIVESTOCK",       unit: "HD",  currency: "USD", basePrice: 1200,  tickSize: 5.0,  lotSize: 1,   description: "Grade A live cattle, 350-500kg" },
  { symbol: "GOAT-SPOT",        name: "Live Goat",                category: "LIVESTOCK",       unit: "HD",  currency: "USD", basePrice: 185,   tickSize: 1.0,  lotSize: 5,   description: "West African dwarf goat, 20-35kg" },
  { symbol: "POULTRY-SPOT",     name: "Live Broiler Chicken",     category: "LIVESTOCK",       unit: "KG",  currency: "USD", basePrice: 2.85,  tickSize: 0.01, lotSize: 500, description: "Live broiler chicken, 1.8-2.2kg" },
  { symbol: "DAIRY-SPOT",       name: "Raw Milk",                 category: "LIVESTOCK",       unit: "L",   currency: "USD", basePrice: 0.48,  tickSize: 0.005,lotSize: 1000,description: "Raw whole milk, 3.5% fat min" },

  // ── FISHERIES ────────────────────────────────────────────
  { symbol: "CATFISH-SPOT",     name: "Dried Catfish",            category: "FISHERIES",       unit: "MT",  currency: "USD", basePrice: 3800,  tickSize: 10.0, lotSize: 0.5, description: "Dried smoked catfish, Nigeria", country: "Nigeria" },
  { symbol: "STOCKFISH-SPOT",   name: "Stockfish",                category: "FISHERIES",       unit: "MT",  currency: "USD", basePrice: 5200,  tickSize: 10.0, lotSize: 0.5, description: "Norwegian stockfish, Grade A" },
  { symbol: "SHRIMP-SPOT",      name: "Frozen Shrimp",            category: "FISHERIES",       unit: "MT",  currency: "USD", basePrice: 6500,  tickSize: 10.0, lotSize: 0.5, description: "IQF white shrimp, 21-25 count" },

  // ── FORESTRY ─────────────────────────────────────────────
  { symbol: "TIMBER-SPOT",      name: "Tropical Hardwood",        category: "FORESTRY",        unit: "M3",  currency: "USD", basePrice: 620,   tickSize: 1.0,  lotSize: 10,  description: "Iroko/Sapele timber, FSC certified" },
  { symbol: "CHARCOAL-SPOT",    name: "Hardwood Charcoal",        category: "FORESTRY",        unit: "MT",  currency: "USD", basePrice: 280,   tickSize: 0.5,  lotSize: 5,   description: "Hardwood charcoal, 30kg bags" },
  { symbol: "RUBBER-SPOT",      name: "Natural Rubber (RSS3)",    category: "FORESTRY",        unit: "MT",  currency: "USD", basePrice: 1650,  tickSize: 2.0,  lotSize: 5,   description: "Ribbed smoked sheet RSS3 grade" },

  // ── ENERGY ───────────────────────────────────────────────
  { symbol: "CRUDE-NG-SPOT",    name: "Bonny Light Crude",        category: "ENERGY",          unit: "BBL", currency: "USD", basePrice: 81.5,  tickSize: 0.01, lotSize: 100, description: "Bonny Light crude oil, Nigeria", country: "Nigeria" },
  { symbol: "CRUDE-MAR27-FUT",  name: "Bonny Light Mar 2027",     category: "ENERGY",          unit: "BBL", currency: "USD", basePrice: 79.8,  tickSize: 0.01, lotSize: 100, description: "Bonny Light crude futures, March 2027", isFutures: true, expiryMonth: "MAR27" },
  { symbol: "NATGAS-SPOT",      name: "Natural Gas",              category: "ENERGY",          unit: "MMBTU",currency:"USD", basePrice: 2.95,  tickSize: 0.001,lotSize: 1000,description: "Henry Hub natural gas" },
  { symbol: "ETHANOL-SPOT",     name: "Fuel Ethanol",             category: "ENERGY",          unit: "L",   currency: "USD", basePrice: 0.62,  tickSize: 0.001,lotSize: 10000,description:"Anhydrous fuel ethanol, 99.5% purity" },
  { symbol: "SOLAR-REC-SPOT",   name: "Solar REC",                category: "ENERGY",          unit: "MWH", currency: "USD", basePrice: 12.5,  tickSize: 0.1,  lotSize: 100, description: "Renewable Energy Certificate, solar" },

  // ── METALS ───────────────────────────────────────────────
  { symbol: "GOLD-SPOT",        name: "Gold",                     category: "METALS",          unit: "OZ",  currency: "USD", basePrice: 2340,  tickSize: 0.1,  lotSize: 1,   description: "LBMA Good Delivery gold bar" },
  { symbol: "SILVER-SPOT",      name: "Silver",                   category: "METALS",          unit: "OZ",  currency: "USD", basePrice: 28.5,  tickSize: 0.01, lotSize: 100, description: "LBMA Good Delivery silver bar" },
  { symbol: "IRON-SPOT",        name: "Iron Ore (62% Fe)",        category: "METALS",          unit: "MT",  currency: "USD", basePrice: 108,   tickSize: 0.5,  lotSize: 100, description: "Iron ore fines, 62% Fe CFR China" },
  { symbol: "COPPER-SPOT",      name: "Copper (Grade A)",         category: "METALS",          unit: "MT",  currency: "USD", basePrice: 9850,  tickSize: 5.0,  lotSize: 5,   description: "LME Grade A copper cathode" },
  { symbol: "TIN-SPOT",         name: "Tin",                      category: "METALS",          unit: "MT",  currency: "USD", basePrice: 31500, tickSize: 10.0, lotSize: 1,   description: "LME Grade A tin ingot" },
  { symbol: "COLTAN-SPOT",      name: "Coltan (Columbite-Tantalite)",category:"METALS",        unit: "KG",  currency: "USD", basePrice: 85,    tickSize: 0.5,  lotSize: 50,  description: "Coltan concentrate, 30% Ta2O5 min", country: "DRC" },
];

// ── Helpers ──────────────────────────────────────────────────

export const COMMODITY_MAP = new Map<string, Commodity>(
  COMMODITIES.map(c => [c.symbol, c])
);

export function getCommodity(symbol: string): Commodity | undefined {
  return COMMODITY_MAP.get(symbol);
}

export function getCommoditiesByCategory(category: CommodityCategory): Commodity[] {
  return COMMODITIES.filter(c => c.category === category);
}

export const CATEGORY_LABELS: Record<CommodityCategory, string> = {
  GRAINS:           "Grains & Cereals",
  OILSEEDS:         "Oilseeds & Oils",
  SPICES:           "Spices & Herbs",
  PULSES:           "Pulses & Legumes",
  SOFT_COMMODITIES: "Soft Commodities",
  ROOT_CROPS:       "Root Crops",
  FRUITS:           "Fruits & Nuts",
  LIVESTOCK:        "Livestock",
  FISHERIES:        "Fisheries",
  FORESTRY:         "Forestry & Rubber",
  ENERGY:           "Energy",
  METALS:           "Metals & Minerals",
};

export const CATEGORY_ICONS: Record<CommodityCategory, string> = {
  GRAINS:           "🌾",
  OILSEEDS:         "🫒",
  SPICES:           "🌶️",
  PULSES:           "🫘",
  SOFT_COMMODITIES: "☕",
  ROOT_CROPS:       "🥔",
  FRUITS:           "🥭",
  LIVESTOCK:        "🐄",
  FISHERIES:        "🐟",
  FORESTRY:         "🌳",
  ENERGY:           "⚡",
  METALS:           "⛏️",
};

// ── Mock price simulation ─────────────────────────────────────

export interface PriceTick {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  bid: number;
  ask: number;
  volume: number;
  high24h: number;
  low24h: number;
  timestamp: number;
}

/** Deterministic pseudo-random walk seeded by symbol + time bucket */
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

export function generateMockTick(symbol: string, seed?: number): PriceTick {
  const commodity = COMMODITY_MAP.get(symbol);
  if (!commodity) throw new Error(`Unknown symbol: ${symbol}`);

  const now = seed ?? Date.now();
  const bucket = Math.floor(now / 5000); // 5-second buckets
  const symbolHash = symbol.split("").reduce((a, c) => a + c.charCodeAt(0), 0);

  const r1 = seededRandom(bucket * 1000 + symbolHash);
  const r2 = seededRandom(bucket * 1001 + symbolHash);
  const r3 = seededRandom(bucket * 1002 + symbolHash);

  const volatility = commodity.basePrice * 0.005; // 0.5% max swing per tick
  const change = (r1 - 0.5) * 2 * volatility;
  const price = Math.max(commodity.basePrice * 0.5, commodity.basePrice + change);
  const spread = commodity.tickSize * (1 + r2 * 2);

  return {
    symbol,
    price: +price.toFixed(4),
    change: +change.toFixed(4),
    changePct: +(change / commodity.basePrice * 100).toFixed(3),
    bid: +(price - spread / 2).toFixed(4),
    ask: +(price + spread / 2).toFixed(4),
    volume: Math.floor(r3 * 1000 + 100) * commodity.lotSize,
    high24h: +(price * (1 + r1 * 0.02)).toFixed(4),
    low24h: +(price * (1 - r2 * 0.02)).toFixed(4),
    timestamp: now,
  };
}

export function generateAllTicks(): PriceTick[] {
  return COMMODITIES.map(c => generateMockTick(c.symbol));
}

// ── Warehouse data ────────────────────────────────────────────

export interface Warehouse {
  id: string;
  name: string;
  city: string;
  state: string;
  country: string;
  lat: number;
  lng: number;
  capacity: number;    // MT
  available: number;   // MT
  certified: boolean;
  commodities: string[]; // accepted commodity symbols
  phone: string;
  manager: string;
}

export const WAREHOUSES: Warehouse[] = [
  { id: "WH-KD-001", name: "Kaduna Ginger Hub",         city: "Kaduna",   state: "Kaduna",   country: "Nigeria", lat: 10.5222, lng: 7.4383,  capacity: 5000, available: 2800, certified: true,  commodities: ["GINGER-NG-SPOT","GINGER-WHOLE-SPOT","PEPPER-BLK-SPOT","CHILI-SPOT"], phone: "+234-800-001-0001", manager: "Musa Abdullahi" },
  { id: "WH-BA-001", name: "Bauchi Spice Depot",         city: "Bauchi",   state: "Bauchi",   country: "Nigeria", lat: 10.3158, lng: 9.8442,  capacity: 3000, available: 1500, certified: true,  commodities: ["GINGER-NG-SPOT","GINGER-WHOLE-SPOT","SORGHUM-SPOT","MILLET-SPOT"],   phone: "+234-800-001-0002", manager: "Ibrahim Sule" },
  { id: "WH-NS-001", name: "Nasarawa Agro Store",        city: "Lafia",    state: "Nasarawa", country: "Nigeria", lat: 8.4966,  lng: 8.5141,  capacity: 4000, available: 2200, certified: true,  commodities: ["GINGER-NG-SPOT","YAM-SPOT","CASSAVA-SPOT","COWPEA-SPOT"],             phone: "+234-800-001-0003", manager: "Emmanuel Ogah" },
  { id: "WH-BN-001", name: "Benue Root Crops Facility",  city: "Makurdi",  state: "Benue",    country: "Nigeria", lat: 7.7337,  lng: 8.5374,  capacity: 6000, available: 3100, certified: true,  commodities: ["YAM-SPOT","CASSAVA-SPOT","SWEETPOTATO-SPOT","SOYBEAN-SPOT"],          phone: "+234-800-001-0004", manager: "Terver Iorliam" },
  { id: "WH-KN-001", name: "Kano Grain Exchange Hub",    city: "Kano",     state: "Kano",     country: "Nigeria", lat: 12.0022, lng: 8.5920,  capacity: 10000,available: 5500, certified: true,  commodities: ["MAIZE-NG-SPOT","WHEAT-SPOT","SORGHUM-SPOT","GROUNDNUT-SPOT","COWPEA-SPOT"], phone: "+234-800-001-0005", manager: "Usman Dankabo" },
  { id: "WH-LA-001", name: "Lagos Port Cold Store",      city: "Lagos",    state: "Lagos",    country: "Nigeria", lat: 6.4541,  lng: 3.3947,  capacity: 8000, available: 4200, certified: true,  commodities: ["COCOA-SPOT","COFFEE-SPOT","CATFISH-SPOT","STOCKFISH-SPOT","SHRIMP-SPOT"], phone: "+234-800-001-0006", manager: "Adaeze Okonkwo" },
  { id: "WH-OY-001", name: "Oyo Cocoa Warehouse",        city: "Ibadan",   state: "Oyo",      country: "Nigeria", lat: 7.3775,  lng: 3.9470,  capacity: 7000, available: 3800, certified: true,  commodities: ["COCOA-SPOT","COCOA-MAR27-FUT","RUBBER-SPOT","PALMOIL-SPOT"],           phone: "+234-800-001-0007", manager: "Segun Adesanya" },
  { id: "WH-EN-001", name: "Enugu Cassava Hub",          city: "Enugu",    state: "Enugu",    country: "Nigeria", lat: 6.4584,  lng: 7.5464,  capacity: 4500, available: 2100, certified: true,  commodities: ["CASSAVA-SPOT","YAM-SPOT","PALMOIL-SPOT","COWPEA-SPOT"],                phone: "+234-800-001-0008", manager: "Chukwuemeka Eze" },
  { id: "WH-GH-001", name: "Accra Commodity Terminal",   city: "Accra",    state: "Greater Accra", country: "Ghana", lat: 5.6037, lng: -0.1870, capacity: 12000,available: 7000, certified: true,  commodities: ["COCOA-SPOT","GOLD-SPOT","TIMBER-SPOT","RUBBER-SPOT"],               phone: "+233-800-001-0001", manager: "Kofi Mensah" },
  { id: "WH-ET-001", name: "Addis Ababa Coffee Hub",     city: "Addis Ababa",state: "Addis Ababa",country:"Ethiopia",lat:9.0320,lng:38.7469, capacity: 5000, available: 2800, certified: true,  commodities: ["COFFEE-SPOT","SESAME-SPOT","CHICKPEA-SPOT","LENTIL-SPOT"],             phone: "+251-800-001-0001", manager: "Abebe Girma" },
];

// ── Grade specifications ──────────────────────────────────────

export interface GradeSpec {
  code: string;
  commodity: string;
  name: string;
  description: string;
  premiumPct: number; // price premium over base grade (%)
}

export const GRADE_SPECS: GradeSpec[] = [
  { code: "NG-SPLIT-DRY-G1",  commodity: "GINGER-NG-SPOT",    name: "Nigeria Split Dry Grade 1",  description: "Split dried ginger, <12% moisture, <2% foreign matter, Kaduna/Bauchi origin", premiumPct: 0 },
  { code: "NG-SPLIT-DRY-G2",  commodity: "GINGER-NG-SPOT",    name: "Nigeria Split Dry Grade 2",  description: "Split dried ginger, <14% moisture, <4% foreign matter", premiumPct: -8 },
  { code: "NG-WHOLE-DRY-G1",  commodity: "GINGER-WHOLE-SPOT", name: "Nigeria Whole Dry Grade 1",  description: "Whole dried ginger, <12% moisture, uniform size", premiumPct: 0 },
  { code: "NG-FRESH-G1",      commodity: "GINGER-NG-SPOT",    name: "Nigeria Fresh Grade 1",      description: "Fresh ginger rhizome, 80-120g per piece, no rot", premiumPct: -15 },
  { code: "MAIZE-G1-WH",      commodity: "MAIZE-NG-SPOT",     name: "White Maize Grade 1",        description: "White maize, <14% moisture, <1% damaged kernels", premiumPct: 0 },
  { code: "MAIZE-G2-WH",      commodity: "MAIZE-NG-SPOT",     name: "White Maize Grade 2",        description: "White maize, <15% moisture, <3% damaged kernels", premiumPct: -5 },
  { code: "COCOA-G1",         commodity: "COCOA-SPOT",        name: "Cocoa Grade 1 (Fine)",       description: "Fermented cocoa, <7.5% moisture, <5% defects, 100 beans/100g", premiumPct: 5 },
  { code: "COCOA-G2",         commodity: "COCOA-SPOT",        name: "Cocoa Grade 2",              description: "Fermented cocoa, <7.5% moisture, <10% defects", premiumPct: 0 },
  { code: "SOYBEAN-G1",       commodity: "SOYBEAN-SPOT",      name: "Soybean Grade 1",            description: "Non-GMO soybean, <13% moisture, <1% foreign matter, >36% protein", premiumPct: 0 },
  { code: "GROUNDNUT-G1",     commodity: "GROUNDNUT-SPOT",    name: "Groundnut Grade 1 (Runner)", description: "Runner-type groundnut, shelled, <8% moisture, aflatoxin <4ppb", premiumPct: 0 },
];
