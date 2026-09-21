"""
Column contracts for NEXCOM ML platform tables.

These contracts mirror the production enums in drizzle/schema.ts
(`stakeholder_type`: FARMER/TRADER/BROKER/WAREHOUSE_OPERATOR/MARKET_MAKER/ADMIN)
and define the bronze-layer tables produced by data/synthetic_nigeria.py and
lakehouse/extractor.py. Every downstream layer validates against these.

Closes audit A3 gap: previously there was no canonical schema for ML training
data (routes fabricated per-request features via md5-seeded RNG).
"""
from __future__ import annotations

# ── Stakeholder enums (match drizzle/schema.ts stakeholderTypeEnum) ───────────
STAKEHOLDER_TYPES = ["FARMER", "TRADER", "BROKER", "WAREHOUSE_OPERATOR", "MARKET_MAKER"]

# ── Nigerian geography: 36 states + FCT ──────────────────────────────────────
# (state, weight) — weighted towards the agri belts per blueprint.
NIGERIAN_STATES: list[tuple[str, float]] = [
    ("Kaduna", 7.0), ("Kano", 8.0), ("Katsina", 5.0), ("Benue", 7.0),
    ("Plateau", 5.0), ("Oyo", 5.0), ("Niger", 5.0), ("Taraba", 3.5),
    ("Adamawa", 3.5), ("Borno", 3.0), ("Bauchi", 3.0), ("Gombe", 2.5),
    ("Jigawa", 3.0), ("Zamfara", 2.5), ("Sokoto", 2.5), ("Kebbi", 3.0),
    ("Kwara", 3.0), ("Nasarawa", 3.5), ("Kogi", 3.0), ("Ogun", 3.0),
    ("Ondo", 3.0), ("Osun", 2.0), ("Ekiti", 1.5),
    ("Lagos", 6.0), ("Abia", 1.5), ("Anambra", 2.5), ("Ebonyi", 2.5),
    ("Enugu", 2.0), ("Imo", 1.5), ("Cross River", 2.5), ("Akwa Ibom", 1.5),
    ("Rivers", 2.0), ("Bayelsa", 0.8), ("Delta", 2.0), ("Edo", 2.0),
    ("Yobe", 1.5), ("FCT", 2.0),
]
assert len(NIGERIAN_STATES) == 37, f"expected 36 states + FCT, got {len(NIGERIAN_STATES)}"

STATE_NAMES = [s for s, _ in NIGERIAN_STATES]
STATE_WEIGHTS = [w for _, w in NIGERIAN_STATES]

# A small set of well-known LGAs per major agri state (fallback: "<State> Central").
LGAS_BY_STATE: dict[str, list[str]] = {
    "Kaduna": ["Zaria", "Kafanchan", "Makarfi", "Soba"],
    "Kano": ["Kano Municipal", "Wudil", "Gwarzo", "Bichi"],
    "Katsina": ["Daura", "Funtua", "Malumfashi"],
    "Benue": ["Makurdi", "Gboko", "Otukpo", "Vandeikya"],
    "Plateau": ["Jos North", "Barkin Ladi", "Bokkos", "Mangu"],
    "Oyo": ["Ibadan North", "Ogbomosho", "Oyo", "Iseyin"],
    "Niger": ["Minna", "Bida", "Kontagora", "Suleja"],
    "Lagos": ["Ikeja", "Eti-Osa", "Alimosho", "Apapa"],
    "FCT": ["Abuja Municipal", "Gwagwalada", "Kuje"],
}

# ── Commodities: realistic NGN/MT ranges and harvest calendars ───────────────
# price_lo/price_hi: observed NGN per metric tonne bands (2023-2024).
# harvest_months: main harvest (glut, prices soften); lean months see highs.
COMMODITIES: dict[str, dict] = {
    "maize":       {"price_lo": 250_000, "price_hi": 550_000, "harvest": [9, 10, 11, 12]},
    "paddy_rice":  {"price_lo": 450_000, "price_hi": 850_000, "harvest": [10, 11, 12, 1]},
    "soybean":     {"price_lo": 400_000, "price_hi": 750_000, "harvest": [10, 11, 12]},
    "sorghum":     {"price_lo": 300_000, "price_hi": 600_000, "harvest": [9, 10, 11]},
    "sesame":      {"price_lo": 900_000, "price_hi": 1_600_000, "harvest": [11, 12, 1]},
    "cocoa":       {"price_lo": 2_500_000, "price_hi": 5_500_000, "harvest": [10, 11, 12, 1, 2]},
    "cashew":      {"price_lo": 700_000, "price_hi": 1_300_000, "harvest": [2, 3, 4, 5]},
    "ginger":      {"price_lo": 800_000, "price_hi": 2_000_000, "harvest": [11, 12, 1, 2]},
    "hibiscus":    {"price_lo": 600_000, "price_hi": 1_400_000, "harvest": [11, 12, 1]},
    "millet":      {"price_lo": 280_000, "price_hi": 550_000, "harvest": [9, 10, 11]},
}
COMMODITY_NAMES = list(COMMODITIES.keys())

CHANNELS = ["web", "ussd", "whatsapp", "agent"]
CHANNEL_WEIGHTS = [0.35, 0.30, 0.20, 0.15]

TXN_TYPES = ["ORDER", "TRADE", "SETTLEMENT", "DEPOSIT", "WITHDRAWAL"]
TXN_STATUSES = ["EXECUTED", "SETTLED", "CANCELLED", "FAILED", "PENDING"]

FRAUD_TYPES = [
    "wash_trading", "spoofing", "structuring",
    "account_takeover", "receipt_double_pledge",
]

# Nigerian AML/CTF reporting threshold relevance: cash transactions >= ₦10m
# are reportable to NFIU; structuring fraud splits just under it.
AML_REPORT_THRESHOLD_NGN = 10_000_000.0

# ── Table column contracts ────────────────────────────────────────────────────
USERS_COLUMNS = [
    "user_id", "stakeholder_type", "state", "lga", "phone", "bvn", "nin",
    "cooperative_id", "warehouse_id", "kyc_level", "pep_flag", "adverse_media_flag",
    "created_at", "updated_at",
]

DEVICES_COLUMNS = [
    "device_id", "user_id", "device_type", "os", "first_seen", "last_seen",
]

TRANSACTIONS_COLUMNS = [
    "transaction_id", "timestamp", "date", "type", "side", "status",
    "payer_id", "payee_id", "commodity", "quantity_mt", "price_ngn_per_mt",
    "amount_ngn", "currency", "channel", "state", "lga",
    "device_id", "ip_address", "receipt_id", "settlement_delay_hours",
    "is_cross_border", "updated_at",
]

PRICES_DAILY_COLUMNS = [
    "date", "commodity", "open", "high", "low", "close", "volume_mt",
]

FRAUD_LABELS_COLUMNS = [
    "transaction_id", "user_id", "is_fraud", "fraud_type", "ring_id",
]

# Bronze table registry: name -> (required columns, partition column)
BRONZE_TABLES: dict[str, tuple[list[str], str]] = {
    "transactions": (TRANSACTIONS_COLUMNS, "date"),
    "users": (USERS_COLUMNS, "date"),
    "devices": (DEVICES_COLUMNS, "date"),
    "prices_daily": (PRICES_DAILY_COLUMNS, "date"),
    "fraud_labels": (FRAUD_LABELS_COLUMNS, "date"),
}

# Extractor contract: production Postgres tables -> bronze table names.
PRODUCTION_TABLE_MAP = {
    "transactions": "transactions",
    "users": "users",
    "devices": "devices",
    "prices_daily": "prices_daily",
    "fraud_labels": "fraud_labels",
}
