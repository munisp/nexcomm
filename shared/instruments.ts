/**
 * NEXCOM Exchange — Shared Instrument Definitions
 * Covers: Forex (60+ pairs), Equities (NGX + NYSE/NASDAQ), Crypto (50+ pairs)
 */

// ─── Forex ────────────────────────────────────────────────────────────────────
export interface FxPair {
  symbol: string;      // e.g. "EURUSD"
  base: string;        // e.g. "EUR"
  quote: string;       // e.g. "USD"
  label: string;       // e.g. "Euro / US Dollar"
  category: "MAJOR" | "MINOR" | "EXOTIC" | "NGN_CROSS";
  basePrice: number;   // mid-rate reference
  pipSize: number;     // e.g. 0.0001 for 4-decimal pairs, 0.01 for JPY
  lotSize: number;     // standard lot in base currency units
}

export const FX_PAIRS: FxPair[] = [
  // ── Majors ──
  { symbol: "EURUSD", base: "EUR", quote: "USD", label: "Euro / US Dollar",          category: "MAJOR",     basePrice: 1.0842, pipSize: 0.0001, lotSize: 100000 },
  { symbol: "GBPUSD", base: "GBP", quote: "USD", label: "British Pound / US Dollar", category: "MAJOR",     basePrice: 1.2634, pipSize: 0.0001, lotSize: 100000 },
  { symbol: "USDJPY", base: "USD", quote: "JPY", label: "US Dollar / Japanese Yen",  category: "MAJOR",     basePrice: 149.82, pipSize: 0.01,   lotSize: 100000 },
  { symbol: "USDCHF", base: "USD", quote: "CHF", label: "US Dollar / Swiss Franc",   category: "MAJOR",     basePrice: 0.8991, pipSize: 0.0001, lotSize: 100000 },
  { symbol: "AUDUSD", base: "AUD", quote: "USD", label: "Australian Dollar / USD",   category: "MAJOR",     basePrice: 0.6521, pipSize: 0.0001, lotSize: 100000 },
  { symbol: "USDCAD", base: "USD", quote: "CAD", label: "US Dollar / Canadian Dollar",category: "MAJOR",    basePrice: 1.3642, pipSize: 0.0001, lotSize: 100000 },
  { symbol: "NZDUSD", base: "NZD", quote: "USD", label: "New Zealand Dollar / USD",  category: "MAJOR",     basePrice: 0.6012, pipSize: 0.0001, lotSize: 100000 },
  { symbol: "USDNOK", base: "USD", quote: "NOK", label: "US Dollar / Norwegian Krone",category: "MAJOR",    basePrice: 10.562, pipSize: 0.0001, lotSize: 100000 },
  { symbol: "USDSEK", base: "USD", quote: "SEK", label: "US Dollar / Swedish Krona", category: "MAJOR",     basePrice: 10.341, pipSize: 0.0001, lotSize: 100000 },
  { symbol: "USDDKK", base: "USD", quote: "DKK", label: "US Dollar / Danish Krone",  category: "MAJOR",     basePrice: 6.8912, pipSize: 0.0001, lotSize: 100000 },

  // ── Minors ──
  { symbol: "EURGBP", base: "EUR", quote: "GBP", label: "Euro / British Pound",       category: "MINOR",    basePrice: 0.8582, pipSize: 0.0001, lotSize: 100000 },
  { symbol: "EURJPY", base: "EUR", quote: "JPY", label: "Euro / Japanese Yen",        category: "MINOR",    basePrice: 162.41, pipSize: 0.01,   lotSize: 100000 },
  { symbol: "GBPJPY", base: "GBP", quote: "JPY", label: "British Pound / Yen",        category: "MINOR",    basePrice: 189.24, pipSize: 0.01,   lotSize: 100000 },
  { symbol: "EURCHF", base: "EUR", quote: "CHF", label: "Euro / Swiss Franc",         category: "MINOR",    basePrice: 0.9742, pipSize: 0.0001, lotSize: 100000 },
  { symbol: "GBPCHF", base: "GBP", quote: "CHF", label: "British Pound / Swiss Franc",category: "MINOR",   basePrice: 1.1362, pipSize: 0.0001, lotSize: 100000 },
  { symbol: "AUDJPY", base: "AUD", quote: "JPY", label: "Australian Dollar / Yen",    category: "MINOR",    basePrice: 97.62,  pipSize: 0.01,   lotSize: 100000 },
  { symbol: "CADJPY", base: "CAD", quote: "JPY", label: "Canadian Dollar / Yen",      category: "MINOR",    basePrice: 109.82, pipSize: 0.01,   lotSize: 100000 },
  { symbol: "NZDJPY", base: "NZD", quote: "JPY", label: "New Zealand Dollar / Yen",   category: "MINOR",    basePrice: 90.14,  pipSize: 0.01,   lotSize: 100000 },
  { symbol: "EURAUD", base: "EUR", quote: "AUD", label: "Euro / Australian Dollar",   category: "MINOR",    basePrice: 1.6622, pipSize: 0.0001, lotSize: 100000 },
  { symbol: "EURCAD", base: "EUR", quote: "CAD", label: "Euro / Canadian Dollar",     category: "MINOR",    basePrice: 1.4781, pipSize: 0.0001, lotSize: 100000 },
  { symbol: "GBPAUD", base: "GBP", quote: "AUD", label: "British Pound / AUD",        category: "MINOR",    basePrice: 1.9362, pipSize: 0.0001, lotSize: 100000 },
  { symbol: "GBPCAD", base: "GBP", quote: "CAD", label: "British Pound / CAD",        category: "MINOR",    basePrice: 1.7241, pipSize: 0.0001, lotSize: 100000 },
  { symbol: "AUDCAD", base: "AUD", quote: "CAD", label: "Australian Dollar / CAD",    category: "MINOR",    basePrice: 0.8962, pipSize: 0.0001, lotSize: 100000 },
  { symbol: "AUDNZD", base: "AUD", quote: "NZD", label: "Australian Dollar / NZD",    category: "MINOR",    basePrice: 1.0841, pipSize: 0.0001, lotSize: 100000 },
  { symbol: "AUDCHF", base: "AUD", quote: "CHF", label: "Australian Dollar / CHF",    category: "MINOR",    basePrice: 0.5862, pipSize: 0.0001, lotSize: 100000 },

  // ── NGN Crosses (Nigerian Naira) ──
  { symbol: "USDNGN", base: "USD", quote: "NGN", label: "US Dollar / Nigerian Naira",  category: "NGN_CROSS", basePrice: 1612.5, pipSize: 0.01, lotSize: 10000 },
  { symbol: "EURNGN", base: "EUR", quote: "NGN", label: "Euro / Nigerian Naira",        category: "NGN_CROSS", basePrice: 1747.2, pipSize: 0.01, lotSize: 10000 },
  { symbol: "GBPNGN", base: "GBP", quote: "NGN", label: "British Pound / Nigerian Naira",category: "NGN_CROSS",basePrice: 2036.8, pipSize: 0.01, lotSize: 10000 },
  { symbol: "CNYngn", base: "CNY", quote: "NGN", label: "Chinese Yuan / Nigerian Naira",category: "NGN_CROSS", basePrice: 222.4,  pipSize: 0.01, lotSize: 10000 },
  { symbol: "ZARNGN", base: "ZAR", quote: "NGN", label: "South African Rand / NGN",    category: "NGN_CROSS", basePrice: 88.62,  pipSize: 0.01, lotSize: 10000 },
  { symbol: "GHS",    base: "GHS", quote: "NGN", label: "Ghanaian Cedi / Nigerian Naira",category: "NGN_CROSS",basePrice: 107.3,  pipSize: 0.01, lotSize: 10000 },
  { symbol: "KESNGH", base: "KES", quote: "NGN", label: "Kenyan Shilling / NGN",        category: "NGN_CROSS", basePrice: 12.48,  pipSize: 0.001,lotSize: 10000 },
  { symbol: "AEDNGN", base: "AED", quote: "NGN", label: "UAE Dirham / Nigerian Naira",  category: "NGN_CROSS", basePrice: 439.0,  pipSize: 0.01, lotSize: 10000 },
  { symbol: "CADNGN", base: "CAD", quote: "NGN", label: "Canadian Dollar / NGN",        category: "NGN_CROSS", basePrice: 1182.4, pipSize: 0.01, lotSize: 10000 },
  { symbol: "JPYNGN", base: "JPY", quote: "NGN", label: "Japanese Yen / NGN",           category: "NGN_CROSS", basePrice: 10.76,  pipSize: 0.001,lotSize: 100000 },

  // ── Exotics ──
  { symbol: "USDZAR", base: "USD", quote: "ZAR", label: "US Dollar / South African Rand",category: "EXOTIC", basePrice: 18.192, pipSize: 0.0001, lotSize: 100000 },
  { symbol: "USDTRY", base: "USD", quote: "TRY", label: "US Dollar / Turkish Lira",     category: "EXOTIC",  basePrice: 32.142, pipSize: 0.0001, lotSize: 100000 },
  { symbol: "USDBRL", base: "USD", quote: "BRL", label: "US Dollar / Brazilian Real",   category: "EXOTIC",  basePrice: 4.9821, pipSize: 0.0001, lotSize: 100000 },
  { symbol: "USDMXN", base: "USD", quote: "MXN", label: "US Dollar / Mexican Peso",     category: "EXOTIC",  basePrice: 17.082, pipSize: 0.0001, lotSize: 100000 },
  { symbol: "USDSGD", base: "USD", quote: "SGD", label: "US Dollar / Singapore Dollar", category: "EXOTIC",  basePrice: 1.3421, pipSize: 0.0001, lotSize: 100000 },
  { symbol: "USDHKD", base: "USD", quote: "HKD", label: "US Dollar / Hong Kong Dollar", category: "EXOTIC",  basePrice: 7.8241, pipSize: 0.0001, lotSize: 100000 },
  { symbol: "USDCNH", base: "USD", quote: "CNH", label: "US Dollar / Chinese Yuan",     category: "EXOTIC",  basePrice: 7.2341, pipSize: 0.0001, lotSize: 100000 },
  { symbol: "USDINR", base: "USD", quote: "INR", label: "US Dollar / Indian Rupee",     category: "EXOTIC",  basePrice: 83.421, pipSize: 0.0001, lotSize: 100000 },
  { symbol: "USDKES", base: "USD", quote: "KES", label: "US Dollar / Kenyan Shilling",  category: "EXOTIC",  basePrice: 129.42, pipSize: 0.01,   lotSize: 10000  },
  { symbol: "USDGHS", base: "USD", quote: "GHS", label: "US Dollar / Ghanaian Cedi",    category: "EXOTIC",  basePrice: 15.042, pipSize: 0.0001, lotSize: 10000  },
  { symbol: "USDEGP", base: "USD", quote: "EGP", label: "US Dollar / Egyptian Pound",   category: "EXOTIC",  basePrice: 47.82,  pipSize: 0.01,   lotSize: 10000  },
  { symbol: "USDAED", base: "USD", quote: "AED", label: "US Dollar / UAE Dirham",       category: "EXOTIC",  basePrice: 3.6725, pipSize: 0.0001, lotSize: 100000 },
  { symbol: "USDSAR", base: "USD", quote: "SAR", label: "US Dollar / Saudi Riyal",      category: "EXOTIC",  basePrice: 3.7501, pipSize: 0.0001, lotSize: 100000 },
  { symbol: "USDTHB", base: "USD", quote: "THB", label: "US Dollar / Thai Baht",        category: "EXOTIC",  basePrice: 35.142, pipSize: 0.01,   lotSize: 100000 },
  { symbol: "USDPLN", base: "USD", quote: "PLN", label: "US Dollar / Polish Zloty",     category: "EXOTIC",  basePrice: 3.9821, pipSize: 0.0001, lotSize: 100000 },
  { symbol: "USDHUF", base: "USD", quote: "HUF", label: "US Dollar / Hungarian Forint", category: "EXOTIC",  basePrice: 362.41, pipSize: 0.01,   lotSize: 100000 },
  { symbol: "USDCZK", base: "USD", quote: "CZK", label: "US Dollar / Czech Koruna",     category: "EXOTIC",  basePrice: 23.142, pipSize: 0.0001, lotSize: 100000 },
  { symbol: "USDRUB", base: "USD", quote: "RUB", label: "US Dollar / Russian Ruble",    category: "EXOTIC",  basePrice: 91.42,  pipSize: 0.01,   lotSize: 100000 },
  { symbol: "USDPHP", base: "USD", quote: "PHP", label: "US Dollar / Philippine Peso",  category: "EXOTIC",  basePrice: 56.42,  pipSize: 0.01,   lotSize: 100000 },
  { symbol: "USDIDR", base: "USD", quote: "IDR", label: "US Dollar / Indonesian Rupiah",category: "EXOTIC",  basePrice: 15842,  pipSize: 1,      lotSize: 100000 },
];

export const FX_CATEGORIES = ["ALL", "MAJOR", "MINOR", "NGN_CROSS", "EXOTIC"] as const;
export type FxCategory = typeof FX_CATEGORIES[number];

// ─── Equities ─────────────────────────────────────────────────────────────────
export interface Equity {
  symbol: string;
  name: string;
  exchange: "NGX" | "NYSE" | "NASDAQ" | "LSE";
  sector: string;
  basePrice: number;
  currency: string;
  marketCap: string;
  lotSize: number;
}

export const EQUITIES: Equity[] = [
  // ── NGX (Nigerian Exchange Group) ──
  { symbol: "DANGCEM",  name: "Dangote Cement Plc",         exchange: "NGX",    sector: "Materials",       basePrice: 412.5,  currency: "NGN", marketCap: "7.0T",  lotSize: 100 },
  { symbol: "MTNN",     name: "MTN Nigeria Communications", exchange: "NGX",    sector: "Telecom",         basePrice: 198.4,  currency: "NGN", marketCap: "4.0T",  lotSize: 100 },
  { symbol: "AIRTELAFRI",name: "Airtel Africa Plc",         exchange: "NGX",    sector: "Telecom",         basePrice: 1842.0, currency: "NGN", marketCap: "2.1T",  lotSize: 100 },
  { symbol: "GTCO",     name: "Guaranty Trust Holding Co.", exchange: "NGX",    sector: "Financials",      basePrice: 42.8,   currency: "NGN", marketCap: "1.3T",  lotSize: 100 },
  { symbol: "ZENITHBANK",name: "Zenith Bank Plc",           exchange: "NGX",    sector: "Financials",      basePrice: 36.9,   currency: "NGN", marketCap: "1.2T",  lotSize: 100 },
  { symbol: "FBNH",     name: "FBN Holdings Plc",           exchange: "NGX",    sector: "Financials",      basePrice: 22.4,   currency: "NGN", marketCap: "800B",  lotSize: 100 },
  { symbol: "ACCESSCORP",name: "Access Holdings Plc",       exchange: "NGX",    sector: "Financials",      basePrice: 18.6,   currency: "NGN", marketCap: "660B",  lotSize: 100 },
  { symbol: "BUACEMENT", name: "BUA Cement Plc",            exchange: "NGX",    sector: "Materials",       basePrice: 82.4,   currency: "NGN", marketCap: "1.4T",  lotSize: 100 },
  { symbol: "BUAFOODS",  name: "BUA Foods Plc",             exchange: "NGX",    sector: "Consumer Staples",basePrice: 312.0,  currency: "NGN", marketCap: "2.8T",  lotSize: 100 },
  { symbol: "SEPLAT",   name: "Seplat Energy Plc",          exchange: "NGX",    sector: "Energy",          basePrice: 3842.0, currency: "NGN", marketCap: "2.2T",  lotSize: 100 },
  { symbol: "NESTLE",   name: "Nestle Nigeria Plc",         exchange: "NGX",    sector: "Consumer Staples",basePrice: 1042.0, currency: "NGN", marketCap: "830B",  lotSize: 100 },
  { symbol: "PRESCO",   name: "Presco Plc",                 exchange: "NGX",    sector: "Consumer Staples",basePrice: 382.0,  currency: "NGN", marketCap: "381B",  lotSize: 100 },
  { symbol: "OKOMUOIL", name: "Okomu Oil Palm Company",     exchange: "NGX",    sector: "Consumer Staples",basePrice: 312.5,  currency: "NGN", marketCap: "295B",  lotSize: 100 },
  { symbol: "STERLNBANK",name: "Sterling Financial Holdings",exchange: "NGX",   sector: "Financials",      basePrice: 4.82,   currency: "NGN", marketCap: "71B",   lotSize: 100 },
  { symbol: "UACN",     name: "UAC of Nigeria Plc",         exchange: "NGX",    sector: "Industrials",     basePrice: 18.4,   currency: "NGN", marketCap: "42B",   lotSize: 100 },
  { symbol: "TRANSCORP", name: "Transcorp Holdings Plc",    exchange: "NGX",    sector: "Conglomerates",   basePrice: 14.2,   currency: "NGN", marketCap: "108B",  lotSize: 100 },
  { symbol: "WAPCO",    name: "Lafarge Africa Plc",         exchange: "NGX",    sector: "Materials",       basePrice: 42.8,   currency: "NGN", marketCap: "688B",  lotSize: 100 },
  { symbol: "FLOURMILL", name: "Flour Mills of Nigeria",    exchange: "NGX",    sector: "Consumer Staples",basePrice: 48.2,   currency: "NGN", marketCap: "276B",  lotSize: 100 },
  { symbol: "CADBURY",  name: "Cadbury Nigeria Plc",        exchange: "NGX",    sector: "Consumer Staples",basePrice: 22.4,   currency: "NGN", marketCap: "47B",   lotSize: 100 },
  { symbol: "GUINNESS", name: "Guinness Nigeria Plc",       exchange: "NGX",    sector: "Consumer Staples",basePrice: 62.4,   currency: "NGN", marketCap: "117B",  lotSize: 100 },

  // ── NYSE / NASDAQ ──
  { symbol: "AAPL",   name: "Apple Inc.",                   exchange: "NASDAQ", sector: "Technology",      basePrice: 182.52, currency: "USD", marketCap: "2.8T",  lotSize: 1 },
  { symbol: "MSFT",   name: "Microsoft Corporation",        exchange: "NASDAQ", sector: "Technology",      basePrice: 415.32, currency: "USD", marketCap: "3.1T",  lotSize: 1 },
  { symbol: "GOOGL",  name: "Alphabet Inc.",                exchange: "NASDAQ", sector: "Technology",      basePrice: 174.12, currency: "USD", marketCap: "2.2T",  lotSize: 1 },
  { symbol: "AMZN",   name: "Amazon.com Inc.",              exchange: "NASDAQ", sector: "Consumer Discr.", basePrice: 198.42, currency: "USD", marketCap: "2.1T",  lotSize: 1 },
  { symbol: "NVDA",   name: "NVIDIA Corporation",           exchange: "NASDAQ", sector: "Technology",      basePrice: 875.42, currency: "USD", marketCap: "2.2T",  lotSize: 1 },
  { symbol: "META",   name: "Meta Platforms Inc.",          exchange: "NASDAQ", sector: "Technology",      basePrice: 512.42, currency: "USD", marketCap: "1.3T",  lotSize: 1 },
  { symbol: "TSLA",   name: "Tesla Inc.",                   exchange: "NASDAQ", sector: "Consumer Discr.", basePrice: 248.42, currency: "USD", marketCap: "791B",  lotSize: 1 },
  { symbol: "JPM",    name: "JPMorgan Chase & Co.",         exchange: "NYSE",   sector: "Financials",      basePrice: 198.42, currency: "USD", marketCap: "572B",  lotSize: 1 },
  { symbol: "JNJ",    name: "Johnson & Johnson",            exchange: "NYSE",   sector: "Healthcare",      basePrice: 152.42, currency: "USD", marketCap: "367B",  lotSize: 1 },
  { symbol: "XOM",    name: "Exxon Mobil Corporation",      exchange: "NYSE",   sector: "Energy",          basePrice: 112.42, currency: "USD", marketCap: "449B",  lotSize: 1 },
  { symbol: "V",      name: "Visa Inc.",                    exchange: "NYSE",   sector: "Financials",      basePrice: 278.42, currency: "USD", marketCap: "560B",  lotSize: 1 },
  { symbol: "WMT",    name: "Walmart Inc.",                 exchange: "NYSE",   sector: "Consumer Staples",basePrice: 182.42, currency: "USD", marketCap: "492B",  lotSize: 1 },
  { symbol: "BAC",    name: "Bank of America Corp.",        exchange: "NYSE",   sector: "Financials",      basePrice: 38.42,  currency: "USD", marketCap: "302B",  lotSize: 1 },
  { symbol: "GS",     name: "Goldman Sachs Group Inc.",     exchange: "NYSE",   sector: "Financials",      basePrice: 482.42, currency: "USD", marketCap: "157B",  lotSize: 1 },
  { symbol: "CVX",    name: "Chevron Corporation",          exchange: "NYSE",   sector: "Energy",          basePrice: 152.42, currency: "USD", marketCap: "291B",  lotSize: 1 },
  { symbol: "PG",     name: "Procter & Gamble Co.",         exchange: "NYSE",   sector: "Consumer Staples",basePrice: 162.42, currency: "USD", marketCap: "382B",  lotSize: 1 },
  { symbol: "HD",     name: "Home Depot Inc.",              exchange: "NYSE",   sector: "Consumer Discr.", basePrice: 382.42, currency: "USD", marketCap: "380B",  lotSize: 1 },
  { symbol: "UNH",    name: "UnitedHealth Group Inc.",      exchange: "NYSE",   sector: "Healthcare",      basePrice: 542.42, currency: "USD", marketCap: "499B",  lotSize: 1 },
  { symbol: "MA",     name: "Mastercard Inc.",              exchange: "NYSE",   sector: "Financials",      basePrice: 482.42, currency: "USD", marketCap: "453B",  lotSize: 1 },
  { symbol: "DIS",    name: "Walt Disney Company",          exchange: "NYSE",   sector: "Communication",   basePrice: 112.42, currency: "USD", marketCap: "206B",  lotSize: 1 },
];

export const EQUITY_EXCHANGES = ["ALL", "NGX", "NYSE", "NASDAQ"] as const;
export type EquityExchange = typeof EQUITY_EXCHANGES[number];

export const EQUITY_SECTORS = [
  "ALL", "Technology", "Financials", "Energy", "Materials",
  "Consumer Staples", "Consumer Discr.", "Healthcare", "Telecom", "Industrials",
] as const;

// ─── Crypto / Digital Assets ──────────────────────────────────────────────────
export interface CryptoAsset {
  symbol: string;
  name: string;
  category: "LAYER1" | "LAYER2" | "DEFI" | "STABLECOIN" | "TOKENIZED" | "MEME";
  basePrice: number;
  circulatingSupply: string;
  allTimeHigh: number;
}

export const CRYPTO_ASSETS: CryptoAsset[] = [
  // ── Layer 1 ──
  { symbol: "BTCUSDT",  name: "Bitcoin",           category: "LAYER1",     basePrice: 67842.0, circulatingSupply: "19.6M",  allTimeHigh: 73750 },
  { symbol: "ETHUSDT",  name: "Ethereum",          category: "LAYER1",     basePrice: 3542.0,  circulatingSupply: "120.2M", allTimeHigh: 4878  },
  { symbol: "SOLUSDT",  name: "Solana",            category: "LAYER1",     basePrice: 182.42,  circulatingSupply: "462M",   allTimeHigh: 260   },
  { symbol: "ADAUSDT",  name: "Cardano",           category: "LAYER1",     basePrice: 0.4842,  circulatingSupply: "35.7B",  allTimeHigh: 3.10  },
  { symbol: "AVAXUSDT", name: "Avalanche",         category: "LAYER1",     basePrice: 38.42,   circulatingSupply: "406M",   allTimeHigh: 146   },
  { symbol: "DOTUSDT",  name: "Polkadot",          category: "LAYER1",     basePrice: 8.42,    circulatingSupply: "1.4B",   allTimeHigh: 55    },
  { symbol: "NEARUSDT", name: "NEAR Protocol",     category: "LAYER1",     basePrice: 7.42,    circulatingSupply: "1.1B",   allTimeHigh: 20    },
  { symbol: "ATOMUSDT", name: "Cosmos",            category: "LAYER1",     basePrice: 9.42,    circulatingSupply: "392M",   allTimeHigh: 44    },
  { symbol: "ALGOUSDT", name: "Algorand",          category: "LAYER1",     basePrice: 0.182,   circulatingSupply: "8.3B",   allTimeHigh: 3.56  },
  { symbol: "XLMUSDT",  name: "Stellar",           category: "LAYER1",     basePrice: 0.122,   circulatingSupply: "28.8B",  allTimeHigh: 0.94  },

  // ── Layer 2 ──
  { symbol: "MATICUSDT",name: "Polygon",           category: "LAYER2",     basePrice: 0.842,   circulatingSupply: "9.9B",   allTimeHigh: 2.92  },
  { symbol: "ARBUSDT",  name: "Arbitrum",          category: "LAYER2",     basePrice: 1.242,   circulatingSupply: "3.4B",   allTimeHigh: 2.39  },
  { symbol: "OPUSDT",   name: "Optimism",          category: "LAYER2",     basePrice: 2.842,   circulatingSupply: "1.1B",   allTimeHigh: 4.84  },
  { symbol: "LRCUSDT",  name: "Loopring",          category: "LAYER2",     basePrice: 0.242,   circulatingSupply: "1.3B",   allTimeHigh: 3.83  },

  // ── DeFi ──
  { symbol: "UNIUSDT",  name: "Uniswap",           category: "DEFI",       basePrice: 12.42,   circulatingSupply: "600M",   allTimeHigh: 44.97 },
  { symbol: "AAVEUSDT", name: "Aave",              category: "DEFI",       basePrice: 182.42,  circulatingSupply: "14.9M",  allTimeHigh: 661   },
  { symbol: "CRVUSDT",  name: "Curve DAO",         category: "DEFI",       basePrice: 0.542,   circulatingSupply: "2.0B",   allTimeHigh: 60.5  },
  { symbol: "MKRUSDT",  name: "Maker",             category: "DEFI",       basePrice: 2842.0,  circulatingSupply: "901K",   allTimeHigh: 6292  },
  { symbol: "COMPUSDT", name: "Compound",          category: "DEFI",       basePrice: 82.42,   circulatingSupply: "9.8M",   allTimeHigh: 910   },
  { symbol: "SNXUSDT",  name: "Synthetix",         category: "DEFI",       basePrice: 3.42,    circulatingSupply: "303M",   allTimeHigh: 28.5  },
  { symbol: "SUSHIUSDT",name: "SushiSwap",         category: "DEFI",       basePrice: 1.42,    circulatingSupply: "271M",   allTimeHigh: 23.38 },
  { symbol: "YFIUSDT",  name: "yearn.finance",     category: "DEFI",       basePrice: 8842.0,  circulatingSupply: "36.7K",  allTimeHigh: 90787 },

  // ── Stablecoins ──
  { symbol: "USDTUSDT", name: "Tether USD",        category: "STABLECOIN", basePrice: 1.0000,  circulatingSupply: "104B",   allTimeHigh: 1.32  },
  { symbol: "USDCUSDT", name: "USD Coin",          category: "STABLECOIN", basePrice: 1.0000,  circulatingSupply: "44B",    allTimeHigh: 1.17  },
  { symbol: "DAIUSDT",  name: "Dai",               category: "STABLECOIN", basePrice: 1.0000,  circulatingSupply: "5.4B",   allTimeHigh: 1.22  },
  { symbol: "BUSDUSDT", name: "Binance USD",       category: "STABLECOIN", basePrice: 1.0000,  circulatingSupply: "1.2B",   allTimeHigh: 1.15  },

  // ── Tokenized Commodities (NEXCOM native) ──
  { symbol: "XAUSUSDT", name: "Tokenized Gold",    category: "TOKENIZED",  basePrice: 2335.42, circulatingSupply: "12.4M",  allTimeHigh: 2450  },
  { symbol: "XAGUSDT",  name: "Tokenized Silver",  category: "TOKENIZED",  basePrice: 27.42,   circulatingSupply: "84M",    allTimeHigh: 49.5  },
  { symbol: "XCRUDEUSD",name: "Tokenized Crude",   category: "TOKENIZED",  basePrice: 81.42,   circulatingSupply: "5M",     allTimeHigh: 130   },
  { symbol: "XMAIZEUSDT",name:"Tokenized Maize",   category: "TOKENIZED",  basePrice: 284.57,  circulatingSupply: "2M",     allTimeHigh: 350   },
  { symbol: "XCOCOUSD", name: "Tokenized Cocoa",   category: "TOKENIZED",  basePrice: 8533.0,  circulatingSupply: "500K",   allTimeHigh: 10200 },

  // ── Meme / High-vol ──
  { symbol: "DOGEUSDT", name: "Dogecoin",          category: "MEME",       basePrice: 0.1642,  circulatingSupply: "144B",   allTimeHigh: 0.74  },
  { symbol: "SHIBUSDT", name: "Shiba Inu",         category: "MEME",       basePrice: 0.0000242,circulatingSupply: "589T",  allTimeHigh: 0.000088 },
  { symbol: "PEPEUSDT", name: "Pepe",              category: "MEME",       basePrice: 0.0000142,circulatingSupply: "420T",  allTimeHigh: 0.000024 },
  { symbol: "BNBUSDT",  name: "BNB",               category: "LAYER1",     basePrice: 412.42,  circulatingSupply: "153M",   allTimeHigh: 690   },
  { symbol: "XRPUSDT",  name: "XRP",               category: "LAYER1",     basePrice: 0.5842,  circulatingSupply: "53.9B",  allTimeHigh: 3.84  },
  { symbol: "LTCUSDT",  name: "Litecoin",          category: "LAYER1",     basePrice: 82.42,   circulatingSupply: "74.8M",  allTimeHigh: 412   },
  { symbol: "LINKUSDT", name: "Chainlink",         category: "DEFI",       basePrice: 18.42,   circulatingSupply: "587M",   allTimeHigh: 52.7  },
  { symbol: "INJUSDT",  name: "Injective",         category: "LAYER1",     basePrice: 32.42,   circulatingSupply: "93.7M",  allTimeHigh: 52.1  },
  { symbol: "SUIUSDT",  name: "Sui",               category: "LAYER1",     basePrice: 1.842,   circulatingSupply: "2.9B",   allTimeHigh: 2.18  },
  { symbol: "APTUSDT",  name: "Aptos",             category: "LAYER1",     basePrice: 8.42,    circulatingSupply: "434M",   allTimeHigh: 19.9  },
];

export const CRYPTO_CATEGORIES = ["ALL", "LAYER1", "LAYER2", "DEFI", "STABLECOIN", "TOKENIZED", "MEME"] as const;
export type CryptoCategory = typeof CRYPTO_CATEGORIES[number];

// ─── Price simulation helpers ─────────────────────────────────────────────────
export function simulateFxTick(pair: FxPair, prevPrice?: number): { price: number; bid: number; ask: number; change: number; changePct: number; direction: "up" | "down" | "flat" } {
  const base = prevPrice ?? pair.basePrice;
  const drift = (Math.random() - 0.499) * pair.pipSize * 8;
  const price = Math.max(base * 0.5, base + drift);
  const spread = pair.pipSize * (2 + Math.random() * 3);
  const bid = price - spread / 2;
  const ask = price + spread / 2;
  const change = price - pair.basePrice;
  const changePct = (change / pair.basePrice) * 100;
  return {
    price: parseFloat(price.toFixed(pair.pipSize < 0.001 ? 3 : pair.pipSize < 0.01 ? 4 : 2)),
    bid: parseFloat(bid.toFixed(pair.pipSize < 0.001 ? 3 : pair.pipSize < 0.01 ? 4 : 2)),
    ask: parseFloat(ask.toFixed(pair.pipSize < 0.001 ? 3 : pair.pipSize < 0.01 ? 4 : 2)),
    change: parseFloat(change.toFixed(4)),
    changePct: parseFloat(changePct.toFixed(3)),
    direction: drift > 0 ? "up" : drift < 0 ? "down" : "flat",
  };
}

export function simulateEquityTick(equity: Equity, prevPrice?: number): { price: number; change: number; changePct: number; volume: number; direction: "up" | "down" | "flat" } {
  const base = prevPrice ?? equity.basePrice;
  const drift = (Math.random() - 0.499) * base * 0.003;
  const price = Math.max(base * 0.5, base + drift);
  const change = price - equity.basePrice;
  const changePct = (change / equity.basePrice) * 100;
  return {
    price: parseFloat(price.toFixed(equity.currency === "NGN" ? 1 : 2)),
    change: parseFloat(change.toFixed(2)),
    changePct: parseFloat(changePct.toFixed(2)),
    volume: Math.floor(Math.random() * 500000 + 10000),
    direction: drift > 0 ? "up" : drift < 0 ? "down" : "flat",
  };
}

export function simulateCryptoTick(asset: CryptoAsset, prevPrice?: number): { price: number; bid: number; ask: number; change: number; changePct: number; volume: number; direction: "up" | "down" | "flat" } {
  const base = prevPrice ?? asset.basePrice;
  const volatility = asset.category === "MEME" ? 0.012 : asset.category === "STABLECOIN" ? 0.0001 : 0.006;
  const drift = (Math.random() - 0.499) * base * volatility;
  const price = Math.max(base * 0.01, base + drift);
  const spreadPct = asset.category === "STABLECOIN" ? 0.0001 : 0.0005;
  const bid = price * (1 - spreadPct);
  const ask = price * (1 + spreadPct);
  const change = price - asset.basePrice;
  const changePct = (change / asset.basePrice) * 100;
  const dp = price < 0.001 ? 8 : price < 1 ? 6 : price < 100 ? 4 : 2;
  return {
    price: parseFloat(price.toFixed(dp)),
    bid: parseFloat(bid.toFixed(dp)),
    ask: parseFloat(ask.toFixed(dp)),
    change: parseFloat(change.toFixed(dp)),
    changePct: parseFloat(changePct.toFixed(3)),
    volume: Math.floor(Math.random() * 50000000 + 100000),
    direction: drift > 0 ? "up" : drift < 0 ? "down" : "flat",
  };
}
