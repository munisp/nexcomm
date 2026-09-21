"""
Realistic seeded synthetic Nigerian agri-commodity transaction generator.

Generates bronze-format tables (transactions, users, devices, prices_daily,
fraud_labels) with:
  - stakeholder enums matching drizzle/schema.ts (FARMER/TRADER/BROKER/
    WAREHOUSE_OPERATOR/MARKET_MAKER)
  - all 36 Nigerian states + FCT, weighted to agri belts
  - 10 commodities with realistic NGN/MT ranges and harvest-glut seasonality
  - lognormal amounts (₦50k–₦40m), channel mix, diurnal pattern, weekend dips,
    cross-border (CFA) trickle
  - ~2% labeled fraud: wash-trading rings, spoofing, structuring under the ₦10m
    NFIU reporting threshold, impossible-travel account takeover, and warehouse
    receipt double-pledging. Temporal causality preserved: every injected
    pattern is only detectable from data at or before the event timestamp.

CLI:
  python -m mlplatform.data.synthetic_nigeria --transactions 50000 --out /data/lakehouse/bronze

Closes audit A3 gap: the platform previously poisoned its own lake with
unlabeled random stub events (kafka_consumers._generate_stub_events); this
generator provides a deterministic, labeled, causally-consistent dataset.
"""
from __future__ import annotations

import argparse
import hashlib
import logging
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd

from mlplatform.data import schema as S

logger = logging.getLogger("mlplatform.data.synthetic_nigeria")

# Stakeholder mix of the exchange user base.
_STAKEHOLDER_WEIGHTS = {
    "FARMER": 0.45,
    "TRADER": 0.30,
    "BROKER": 0.10,
    "WAREHOUSE_OPERATOR": 0.08,
    "MARKET_MAKER": 0.07,
}

# Diurnal activity weights by hour (WAT business hours dominate).
_HOUR_WEIGHTS = np.array([
    0.05, 0.02, 0.01, 0.01, 0.02, 0.05,   # 00-05
    0.10, 0.25, 0.60, 0.90, 1.00, 0.95,   # 06-11
    0.90, 0.85, 0.80, 0.75, 0.70, 0.55,   # 12-17
    0.40, 0.30, 0.20, 0.12, 0.08, 0.05,   # 18-23
])
_WEEKEND_FACTOR = 0.35

_PHONE_PREFIXES = ["0701", "0703", "0705", "0803", "0805", "0807", "0810", "0813", "0816", "0903", "0906", "0913"]
_DEVICE_TYPES = ["android", "android", "android", "ios", "web", "feature_phone"]
_LENDER_IDS = [f"LENDER-{i:02d}" for i in range(1, 7)]


def _fmt_phone(rng: np.random.Generator) -> str:
    prefix = _PHONE_PREFIXES[int(rng.integers(0, len(_PHONE_PREFIXES)))]
    return f"+234{prefix[1:]}{int(rng.integers(0, 10_000_000)):07d}"


def _fmt_id11(rng: np.random.Generator) -> str:
    """Format-valid fake 11-digit BVN/NIN (never a real number: synthetic rng)."""
    return f"{int(rng.integers(10**10, 10**11))}"


def _cgnat_ip(rng: np.random.Generator) -> str:
    """CGNAT range 100.64.0.0/10 — typical for Nigerian mobile operators."""
    return f"100.{int(rng.integers(64, 128))}.{int(rng.integers(0, 256))}.{int(rng.integers(1, 255))}"


class SyntheticNigeriaGenerator:
    """Seeded generator. All randomness flows from one numpy Generator."""

    def __init__(
        self,
        seed: int = 42,
        n_users: int = 5000,
        days: int = 180,
        end_date: date | None = None,
    ):
        self.seed = seed
        self.rng = np.random.default_rng(seed)
        self.n_users = n_users
        self.days = days
        self.end_date = end_date or datetime.now(timezone.utc).date()
        self.start_date = self.end_date - timedelta(days=days)
        self._users: pd.DataFrame | None = None
        self._devices: pd.DataFrame | None = None
        self._prices: pd.DataFrame | None = None
        self._close_price: dict[tuple[str, str], float] = {}

    # ── Users ────────────────────────────────────────────────────────────────
    def generate_users(self) -> pd.DataFrame:
        rng = self.rng
        n = self.n_users
        types = list(_STAKEHOLDER_WEIGHTS.keys())
        t_weights = np.array(list(_STAKEHOLDER_WEIGHTS.values()))
        stakeholder = rng.choice(types, size=n, p=t_weights / t_weights.sum())

        states_arr = np.array(S.STATE_NAMES)
        s_weights = np.array(S.STATE_WEIGHTS)
        states = rng.choice(states_arr, size=n, p=s_weights / s_weights.sum())

        anchor = datetime.combine(self.end_date, datetime.min.time(), tzinfo=timezone.utc)
        rows = []
        for i in range(n):
            state = str(states[i])
            lgas = S.LGAS_BY_STATE.get(state)
            lga = lgas[int(rng.integers(0, len(lgas)))] if lgas else f"{state} Central"
            age_days = int(rng.integers(30, 2000))
            created = anchor - timedelta(days=age_days)
            is_farmer = stakeholder[i] == "FARMER"
            is_wo = stakeholder[i] == "WAREHOUSE_OPERATOR"
            rows.append({
                "user_id": f"U{i:06d}",
                "stakeholder_type": str(stakeholder[i]),
                "state": state,
                "lga": lga,
                "phone": _fmt_phone(rng),
                "bvn": _fmt_id11(rng),
                "nin": _fmt_id11(rng),
                "cooperative_id": f"COOP-{int(rng.integers(1, 400)):04d}" if is_farmer and rng.random() < 0.35 else "",
                "warehouse_id": f"WH-{int(rng.integers(1, 80)):03d}" if is_wo else "",
                "kyc_level": int(rng.choice([1, 2, 3, 4], p=[0.35, 0.40, 0.20, 0.05])),
                "pep_flag": bool(rng.random() < 0.01),
                "adverse_media_flag": bool(rng.random() < 0.02),
                "created_at": created.isoformat(),
                "updated_at": created.isoformat(),
            })
        self._users = pd.DataFrame(rows, columns=S.USERS_COLUMNS)
        return self._users

    # ── Devices ──────────────────────────────────────────────────────────────
    def generate_devices(self, users: pd.DataFrame | None = None) -> pd.DataFrame:
        rng = self.rng
        users = users if users is not None else self._users
        assert users is not None, "generate users first"
        anchor = datetime.combine(self.end_date, datetime.min.time(), tzinfo=timezone.utc)
        rows = []
        for uid in users["user_id"]:
            n_dev = 1 + int(rng.random() < 0.25)
            for _ in range(n_dev):
                dev_type = _DEVICE_TYPES[int(rng.integers(0, len(_DEVICE_TYPES)))]
                dev_id = "D" + hashlib.sha256(f"{uid}:{rng.random()}".encode()).hexdigest()[:15]
                first = anchor - timedelta(days=int(rng.integers(1, 1500)))
                rows.append({
                    "device_id": dev_id,
                    "user_id": uid,
                    "device_type": dev_type,
                    "os": {"android": "Android", "ios": "iOS", "web": "Web", "feature_phone": "KaiOS"}[dev_type],
                    "first_seen": first.isoformat(),
                    "last_seen": (first + timedelta(days=int(rng.integers(0, 900)))).isoformat(),
                })
        self._devices = pd.DataFrame(rows, columns=S.DEVICES_COLUMNS)
        return self._devices

    # ── Prices with seasonality ───────────────────────────────────────────────
    def _seasonal_factor(self, commodity: str, month: int) -> float:
        harvest = S.COMMODITIES[commodity]["harvest"]
        if month in harvest:
            return 0.88  # harvest glut: prices soften
        if month in (5, 6, 7):
            return 1.15  # lean season: prices peak
        return 1.0

    def generate_prices_daily(self) -> pd.DataFrame:
        rng = self.rng
        dates = pd.date_range(self.start_date, self.end_date, freq="D")
        rows = []
        for commodity, spec in S.COMMODITIES.items():
            lo, hi = spec["price_lo"], spec["price_hi"]
            price = float(np.sqrt(lo * hi))  # geometric mid
            for d in dates:
                seasonal = self._seasonal_factor(commodity, d.month)
                shock = float(rng.normal(0.0, 0.012))
                drift = 0.0004  # mild inflation trend
                price = price * (1 + drift + shock)
                # mean-revert towards seasonal anchor
                anchor = np.sqrt(lo * hi) * seasonal
                price += 0.03 * (anchor - price)
                price = float(np.clip(price, lo * 0.8, hi * 1.25))
                o = price * (1 + float(rng.normal(0, 0.004)))
                c = price
                h = max(o, c) * (1 + abs(float(rng.normal(0, 0.005))))
                l = min(o, c) * (1 - abs(float(rng.normal(0, 0.005))))
                vol = float(max(1.0, rng.lognormal(mean=3.5, sigma=0.8)))
                rows.append({
                    "date": d.strftime("%Y-%m-%d"),
                    "commodity": commodity,
                    "open": round(o, 2), "high": round(h, 2),
                    "low": round(l, 2), "close": round(c, 2),
                    "volume_mt": round(vol, 2),
                })
                self._close_price[(commodity, d.strftime("%Y-%m-%d"))] = c
        self._prices = pd.DataFrame(rows, columns=S.PRICES_DAILY_COLUMNS)
        return self._prices

    # ── Timestamp sampler (diurnal + weekend dip) ────────────────────────────
    def _sample_timestamps(self, n: int) -> list[datetime]:
        rng = self.rng
        day_offsets = np.arange(self.days)
        day_weights = np.array([
            _WEEKEND_FACTOR if (self.start_date + timedelta(days=int(o))).weekday() >= 5 else 1.0
            for o in day_offsets
        ])
        day_weights = day_weights / day_weights.sum()
        chosen_days = rng.choice(day_offsets, size=n, p=day_weights)
        hw = _HOUR_WEIGHTS / _HOUR_WEIGHTS.sum()
        chosen_hours = rng.choice(24, size=n, p=hw)
        chosen_minutes = rng.integers(0, 60, size=n)
        chosen_seconds = rng.integers(0, 60, size=n)
        return [
            datetime.combine(self.start_date + timedelta(days=int(o)), datetime.min.time(), tzinfo=timezone.utc)
            + timedelta(hours=int(h), minutes=int(m), seconds=int(sec))
            for o, h, m, sec in zip(chosen_days, chosen_hours, chosen_minutes, chosen_seconds)
        ]

    # ── Transactions (+ fraud injection) ──────────────────────────────────────
    def generate_transactions(self, n_transactions: int = 50_000) -> tuple[pd.DataFrame, pd.DataFrame]:
        rng = self.rng
        assert self._users is not None and self._devices is not None and self._prices is not None, \
            "generate users, devices and prices first"

        users = self._users
        user_ids = users["user_id"].to_numpy()
        user_state = dict(zip(users["user_id"], users["state"]))
        user_lga = dict(zip(users["user_id"], users["lga"]))
        dev_by_user: dict[str, list[str]] = {}
        for dev, uid in zip(self._devices["device_id"], self._devices["user_id"]):
            dev_by_user.setdefault(uid, []).append(dev)

        commodities = np.array(S.COMMODITY_NAMES)
        # commodity popularity: staples dominate
        pop = np.array([1.6, 1.4, 1.0, 1.0, 0.6, 0.7, 0.6, 0.5, 0.4, 1.2])
        pop = pop / pop.sum()

        rows: list[dict] = []
        labels: list[dict] = []
        seq = 0

        def _next_id() -> str:
            nonlocal seq
            seq += 1
            return f"TXN-{seq:09d}"

        def _amount() -> float:
            # lognormal, clipped to ₦50k – ₦40m
            return float(np.clip(rng.lognormal(mean=13.6, sigma=1.1), 50_000, 40_000_000))

        def _price_for(commodity: str, d: date) -> float:
            key = (commodity, d.strftime("%Y-%m-%d"))
            if key in self._close_price:
                return self._close_price[key]
            spec = S.COMMODITIES[commodity]
            return float(np.sqrt(spec["price_lo"] * spec["price_hi"]))

        def _mk_txn(ts, payer, payee, txn_type, commodity, amount, status="EXECUTED",
                    side=None, channel=None, device=None, ip=None, state=None,
                    receipt_id="", settlement_delay=None):
            price = _price_for(commodity, ts.date()) if commodity else 0.0
            qty = round(amount / price, 3) if price else 0.0
            cross = bool(rng.random() < 0.01)
            return {
                "transaction_id": _next_id(),
                "timestamp": ts.isoformat(),
                "date": ts.strftime("%Y-%m-%d"),
                "type": txn_type,
                "side": side or (str(rng.choice(["BUY", "SELL"])) if txn_type in ("ORDER", "TRADE") else ""),
                "status": status,
                "payer_id": payer,
                "payee_id": payee,
                "commodity": commodity or "",
                "quantity_mt": qty,
                "price_ngn_per_mt": round(price, 2),
                "amount_ngn": round(amount, 2),
                "currency": "XOF" if cross else "NGN",
                "channel": channel or str(rng.choice(S.CHANNELS, p=S.CHANNEL_WEIGHTS)),
                "state": state or user_state.get(payer, "Lagos"),
                "lga": user_lga.get(payer, ""),
                "device_id": device or (rng.choice(dev_by_user[payer]).item() if dev_by_user.get(payer) else "D_unknown"),
                "ip_address": ip or _cgnat_ip(rng),
                "receipt_id": receipt_id,
                "settlement_delay_hours": settlement_delay,
                "is_cross_border": cross,
                "updated_at": ts.isoformat(),
            }

        # ── Normal traffic ────────────────────────────────────────────────────
        n_fraud_target = int(n_transactions * 0.02)
        n_normal = n_transactions - n_fraud_target
        timestamps = self._sample_timestamps(n_normal)
        type_mix = {"ORDER": 0.35, "TRADE": 0.30, "SETTLEMENT": 0.20, "DEPOSIT": 0.10, "WITHDRAWAL": 0.05}
        txn_types = rng.choice(list(type_mix), size=n_normal, p=list(type_mix.values()))
        payer_idx = rng.integers(0, len(user_ids), size=n_normal)
        payee_idx = rng.integers(0, len(user_ids), size=n_normal)
        comm_idx = rng.choice(len(commodities), size=n_normal, p=pop)
        status_roll = rng.random(n_normal)

        for i in range(n_normal):
            payer = str(user_ids[payer_idx[i]])
            payee = str(user_ids[payee_idx[i]])
            if payee == payer:
                payee = str(user_ids[(payee_idx[i] + 1) % len(user_ids)])
            ttype = str(txn_types[i])
            commodity = str(commodities[comm_idx[i]]) if ttype in ("ORDER", "TRADE", "SETTLEMENT") else ""
            amount = _amount()
            roll = status_roll[i]
            if roll < 0.94:
                status = "EXECUTED" if ttype != "SETTLEMENT" else "SETTLED"
            elif roll < 0.98:
                status = "CANCELLED"
            else:
                status = "FAILED"
            delay = None
            if ttype == "SETTLEMENT":
                delay = round(float(rng.lognormal(mean=2.6, sigma=0.6)), 1)  # hours; ~13h median
            rows.append(_mk_txn(timestamps[i], payer, payee, ttype, commodity, amount,
                                status=status, settlement_delay=delay))

        # ── Fraud injection (~2% labeled) ─────────────────────────────────────
        fraud_budget = {
            "wash_trading": int(n_fraud_target * 0.35),
            "spoofing": int(n_fraud_target * 0.20),
            "structuring": int(n_fraud_target * 0.25),
            "account_takeover": int(n_fraud_target * 0.12),
            "receipt_double_pledge": int(n_fraud_target * 0.08),
        }
        traders = [u for u, t in zip(users["user_id"], users["stakeholder_type"]) if t in ("TRADER", "BROKER")]

        # 1) Wash-trading rings: 3-8 accounts, circular same-commodity trades,
        #    ring members share a device/IP (graph-detectable).
        ring_seq = 0
        wash_n = fraud_budget["wash_trading"]
        while wash_n > 0 and traders:
            ring_size = int(rng.integers(3, 9))
            if len(traders) < ring_size:
                break
            members = [str(traders.pop(int(rng.integers(0, len(traders))))) for _ in range(ring_size)]
            ring_seq += 1
            ring_id = f"RING-{ring_seq:04d}"
            ring_device = "D" + hashlib.sha256(f"ring:{ring_id}".encode()).hexdigest()[:15]
            ring_ip = _cgnat_ip(rng)
            commodity = str(rng.choice(commodities, p=pop))
            base_amount = float(rng.uniform(2_000_000, 15_000_000))
            cycles = max(1, wash_n // (ring_size * 2))
            start_day = int(rng.integers(10, max(11, self.days - 15)))
            for cyc in range(cycles):
                day = self.start_date + timedelta(days=start_day + cyc)
                for k in range(ring_size):
                    payer = members[k]
                    payee = members[(k + 1) % ring_size]
                    ts = datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc) + timedelta(
                        hours=int(rng.integers(9, 18)), minutes=int(rng.integers(0, 60)))
                    amount = base_amount * float(rng.uniform(0.97, 1.03))
                    shared = bool(rng.random() < 0.6)
                    txn = _mk_txn(ts, payer, payee, "TRADE", commodity, amount,
                                  device=ring_device if shared else None,
                                  ip=ring_ip if shared else None)
                    rows.append(txn)
                    labels.append({"transaction_id": txn["transaction_id"], "user_id": payer,
                                   "is_fraud": True, "fraud_type": "wash_trading", "ring_id": ring_id})
                    wash_n -= 1
                    if wash_n <= 0:
                        break
                if wash_n <= 0:
                    break

        # 2) Spoofing: very large orders placed then cancelled shortly after.
        for _ in range(fraud_budget["spoofing"]):
            payer = str(rng.choice(user_ids))
            ts = self._sample_timestamps(1)[0]
            commodity = str(rng.choice(commodities, p=pop))
            amount = float(rng.uniform(20_000_000, 40_000_000))
            txn = _mk_txn(ts, payer, str(rng.choice(user_ids)), "ORDER", commodity,
                          amount, status="CANCELLED")
            rows.append(txn)
            labels.append({"transaction_id": txn["transaction_id"], "user_id": payer,
                           "is_fraud": True, "fraud_type": "spoofing", "ring_id": ""})

        # 3) Structuring/smurfing: same-day DEPOSIT splits each < ₦10m that
        #    together exceed the NFIU reporting threshold.
        struct_n = fraud_budget["structuring"]
        while struct_n > 0:
            payer = str(rng.choice(user_ids))
            day = self.start_date + timedelta(days=int(rng.integers(0, self.days)))
            splits = int(rng.integers(3, 7))
            amounts = rng.uniform(6_000_000, 9_900_000, size=splits)
            for k in range(splits):
                ts = datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc) + timedelta(
                    hours=int(rng.integers(8, 20)), minutes=int(rng.integers(0, 60)))
                txn = _mk_txn(ts, payer, "NEXCOM-SETTLEMENT-BANK", "DEPOSIT", "",
                              float(amounts[k]), channel=str(rng.choice(["agent", "ussd", "web"])))
                rows.append(txn)
                labels.append({"transaction_id": txn["transaction_id"], "user_id": payer,
                               "is_fraud": True, "fraud_type": "structuring", "ring_id": ""})
                struct_n -= 1
                if struct_n <= 0:
                    break

        # 4) Account takeover with impossible travel: Lagos -> Kano in 20 min,
        #    from an unknown device/IP.
        ato_pairs = max(1, fraud_budget["account_takeover"] // 2)
        for _ in range(ato_pairs):
            victim = str(rng.choice(user_ids))
            day = self.start_date + timedelta(days=int(rng.integers(1, self.days)))
            t0 = datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc) + timedelta(
                hours=int(rng.integers(8, 20)))
            legit = _mk_txn(t0, victim, str(rng.choice(user_ids)), "WITHDRAWAL", "",
                            _amount(), state="Lagos")
            rogue_device = "D" + hashlib.sha256(f"ato:{victim}:{day}".encode()).hexdigest()[:15]
            fraud = _mk_txn(t0 + timedelta(minutes=20), victim, str(rng.choice(user_ids)),
                            "WITHDRAWAL", "", _amount(), state="Kano",
                            device=rogue_device, ip=_cgnat_ip(rng))
            rows.append(legit)
            rows.append(fraud)
            labels.append({"transaction_id": fraud["transaction_id"], "user_id": victim,
                           "is_fraud": True, "fraud_type": "account_takeover", "ring_id": ""})

        # 5) Warehouse receipt double-pledging: the same receipt pledged as
        #    collateral to two different lenders.
        receipt_seq = 0
        for _ in range(fraud_budget["receipt_double_pledge"] // 2):
            receipt_seq += 1
            receipt_id = f"WR-{receipt_seq:06d}"
            fraudster = str(rng.choice(user_ids))
            commodity = str(rng.choice(commodities, p=pop))
            day = self.start_date + timedelta(days=int(rng.integers(0, self.days - 2)))
            amount = float(rng.uniform(5_000_000, 25_000_000))
            lenders = list(rng.choice(_LENDER_IDS, size=2, replace=False))
            for k, lender in enumerate(lenders):
                ts = datetime.combine(day + timedelta(days=k), datetime.min.time(), tzinfo=timezone.utc) + timedelta(
                    hours=int(rng.integers(9, 17)))
                txn = _mk_txn(ts, fraudster, str(lender), "ORDER", commodity, amount,
                              receipt_id=receipt_id)
                rows.append(txn)
                labels.append({"transaction_id": txn["transaction_id"], "user_id": fraudster,
                               "is_fraud": True, "fraud_type": "receipt_double_pledge", "ring_id": ""})

        txns = pd.DataFrame(rows, columns=S.TRANSACTIONS_COLUMNS)
        txns = txns.sort_values("timestamp").reset_index(drop=True)  # temporal causality
        labels_df = pd.DataFrame(labels, columns=S.FRAUD_LABELS_COLUMNS)
        logger.info("generated %d transactions, %d fraud labels (%.2f%%)",
                    len(txns), len(labels_df), 100.0 * len(labels_df) / max(1, len(txns)))
        return txns, labels_df

    # ── Orchestration ─────────────────────────────────────────────────────────
    def generate(self, n_transactions: int = 50_000) -> dict[str, pd.DataFrame]:
        users = self.generate_users()
        devices = self.generate_devices(users)
        prices = self.generate_prices_daily()
        txns, labels = self.generate_transactions(n_transactions)
        return {
            "users": users,
            "devices": devices,
            "prices_daily": prices,
            "transactions": txns,
            "fraud_labels": labels,
        }

    def write_bronze(self, out_dir: str, n_transactions: int = 50_000) -> dict[str, int]:
        """Generate all tables and write them in bronze partition layout."""
        from mlplatform.lakehouse.storage import write_table

        tables = self.generate(n_transactions)
        counts = {}
        for name, df in tables.items():
            res = write_table(df, root=out_dir, table=name, partition_col="date")
            counts[name] = res["rows"]
        return counts


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Synthetic Nigerian agri-commodity data generator")
    parser.add_argument("--transactions", type=int, default=50_000)
    parser.add_argument("--users", type=int, default=5000)
    parser.add_argument("--days", type=int, default=180)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out", required=True, help="Bronze output directory (…/lakehouse/bronze)")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    gen = SyntheticNigeriaGenerator(seed=args.seed, n_users=args.users, days=args.days)
    counts = gen.write_bronze(args.out, n_transactions=args.transactions)
    for table, n in counts.items():
        print(f"  {table}: {n} rows -> {args.out}/{table}/")


if __name__ == "__main__":
    main()
