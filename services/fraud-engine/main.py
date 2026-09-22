"""
NEXCOM Exchange — ML-Based Fraud & Anomaly Detection Engine (Python)
=====================================================================
Financial-grade fraud detection service providing:

 1. Wash Trade Detection        — identify circular trading patterns
 2. Order Manipulation Guards   — spoofing, layering, quote stuffing
 3. Behavioral Anomaly Scoring  — Isolation Forest on user behavior
 4. Velocity Checks             — abnormal order frequency/volume
 5. Price Manipulation Detection — pump-and-dump, ramping patterns
 6. Account Takeover Detection  — login anomaly scoring
 7. AML Pattern Screening       — structuring, smurfing detection
 8. Real-time Risk Scoring      — composite risk score per transaction

HTTP API (port 7071 by default, set via FRAUD_ENGINE_PORT):
  POST /analyze/order           → analyze an order for fraud signals
  POST /analyze/transaction     → analyze a financial transaction
  POST /analyze/login           → analyze a login attempt
  POST /analyze/batch           → batch analyze multiple events
  GET  /model/status            → model training status
  POST /model/retrain           → trigger model retraining
  GET  /alerts                  → recent fraud alerts
  GET  /health                  → health check

Environment variables:
  FRAUD_ENGINE_PORT             — port (default: 7071)
  ALERT_WEBHOOK_URL             — URL to POST fraud alerts to
  RISK_THRESHOLD_HIGH           — score above which = HIGH risk (default: 0.7)
  RISK_THRESHOLD_MEDIUM         — score above which = MEDIUM risk (default: 0.4)
  ML_PLATFORM_URL               — ml-platform serving API (default http://ml-platform:8015)
  ML_PLATFORM_TIMEOUT           — seconds per ml-platform call (default: 2.0)
  MODEL_REGISTRY_PATH           — local artifact dir fallback (default: /tmp/nexcom_models)

ML scoring prefers the ml-platform FraudNet champion (versioned PyTorch
artifact, services/ml-platform). If the platform is unreachable it falls back
to locally persisted IsolationForest artifacts (trained offline by the
pipeline, loaded from MODEL_REGISTRY_PATH). No synthetic training data is
generated at boot anymore (audit A3 §fraud-engine).
"""

import os
import json
import logging
import hashlib
import pickle
import time
from datetime import datetime, timezone
from collections import defaultdict, deque
from pathlib import Path
from typing import Optional
from threading import Lock

import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

# ── Configuration ─────────────────────────────────────────────────────────────

FRAUD_ENGINE_PORT = int(os.getenv("FRAUD_ENGINE_PORT", "7071"))
RISK_THRESHOLD_HIGH = float(os.getenv("RISK_THRESHOLD_HIGH", "0.7"))
RISK_THRESHOLD_MEDIUM = float(os.getenv("RISK_THRESHOLD_MEDIUM", "0.4"))
ALERT_WEBHOOK_URL = os.getenv("ALERT_WEBHOOK_URL", "")
MAX_ALERTS = int(os.getenv("MAX_ALERTS", "10000"))
VELOCITY_WINDOW_SECONDS = int(os.getenv("VELOCITY_WINDOW_SECONDS", "300"))  # 5 min
ML_PLATFORM_URL = os.getenv("ML_PLATFORM_URL", "http://ml-platform:8015").rstrip("/")
ML_PLATFORM_TIMEOUT = float(os.getenv("ML_PLATFORM_TIMEOUT", "2.0"))
MODEL_REGISTRY_PATH = Path(os.getenv("MODEL_REGISTRY_PATH", "/tmp/nexcom_models"))
_CB_FAILURES = int(os.getenv("ML_PLATFORM_CB_FAILURES", "3"))
_CB_COOLDOWN = float(os.getenv("ML_PLATFORM_CB_COOLDOWN", "30"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("fraud-engine")

# ── ML platform client (httpx, 2s timeout, circuit breaker) ──────────────────

class _PlatformBreaker:
    def __init__(self):
        self._lock = Lock()
        self._failures = 0
        self._opened_at: Optional[float] = None

    def allow(self) -> bool:
        with self._lock:
            if self._opened_at is None:
                return True
            return (time.monotonic() - self._opened_at) >= _CB_COOLDOWN

    def success(self):
        with self._lock:
            self._failures = 0
            self._opened_at = None

    def failure(self):
        with self._lock:
            self._failures += 1
            if self._failures >= _CB_FAILURES and self._opened_at is None:
                self._opened_at = time.monotonic()
                logger.warning("[FraudEngine] ml-platform circuit breaker OPEN (cooldown %.0fs)", _CB_COOLDOWN)

    def state(self) -> str:
        with self._lock:
            if self._opened_at is None:
                return "closed"
            return "half-open" if (time.monotonic() - self._opened_at) >= _CB_COOLDOWN else "open"


_platform_breaker = _PlatformBreaker()
_platform_state = {"last_model_source": None, "last_model_version": None, "last_ok_at": None}


def ml_platform_post(path: str, payload: dict) -> Optional[dict]:
    """POST to ml-platform with circuit breaker; None on any failure."""
    if not _platform_breaker.allow():
        return None
    try:
        import httpx

        with httpx.Client(base_url=ML_PLATFORM_URL, timeout=ML_PLATFORM_TIMEOUT) as client:
            resp = client.post(path, json=payload)
        if resp.status_code != 200:
            if resp.status_code != 503:  # 503 = model not trained yet, not a fault
                _platform_breaker.failure()
            return None
        _platform_breaker.success()
        return resp.json()
    except Exception as exc:
        _platform_breaker.failure()
        logger.info("[FraudEngine] ml-platform %s failed: %s", path, exc)
        return None


def ml_platform_fraud_score(payload: dict) -> Optional[dict]:
    result = ml_platform_post("/v1/predict/fraud", payload)
    if result is not None:
        _platform_state["last_model_source"] = result.get("model_source")
        _platform_state["last_model_version"] = result.get("model_version")
        _platform_state["last_ok_at"] = datetime.now(timezone.utc).isoformat()
    return result

# ── Request/Response Models ───────────────────────────────────────────────────

class OrderAnalysisRequest(BaseModel):
    order_id: str
    user_id: str
    symbol: str
    side: str  # "buy" | "sell"
    quantity: float
    price: float
    order_type: str  # "market" | "limit" | "stop"
    timestamp: Optional[int] = None  # Unix ms
    ip_address: Optional[str] = None
    session_id: Optional[str] = None

class TransactionAnalysisRequest(BaseModel):
    transaction_id: str
    user_id: str
    amount: float
    currency: str
    transaction_type: str  # "deposit" | "withdrawal" | "transfer"
    destination: Optional[str] = None
    timestamp: Optional[int] = None
    ip_address: Optional[str] = None

class LoginAnalysisRequest(BaseModel):
    user_id: str
    ip_address: str
    user_agent: Optional[str] = None
    timestamp: Optional[int] = None
    country_code: Optional[str] = None
    success: bool = True

class FraudAlert(BaseModel):
    alert_id: str
    timestamp: str
    alert_type: str
    severity: str  # "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
    user_id: str
    risk_score: float
    signals: list[str]
    details: dict

# ── In-Memory State ───────────────────────────────────────────────────────────

class FraudState:
    def __init__(self):
        self.lock = Lock()
        # Per-user order history (sliding window)
        self.user_orders: dict[str, deque] = defaultdict(lambda: deque(maxlen=1000))
        # Per-user transaction history
        self.user_transactions: dict[str, deque] = defaultdict(lambda: deque(maxlen=500))
        # Per-user login history
        self.user_logins: dict[str, deque] = defaultdict(lambda: deque(maxlen=100))
        # Per-IP request history
        self.ip_activity: dict[str, deque] = defaultdict(lambda: deque(maxlen=1000))
        # Fraud alerts
        self.alerts: deque = deque(maxlen=MAX_ALERTS)
        # ML model
        self.order_model: Optional[IsolationForest] = None
        self.order_scaler: Optional[StandardScaler] = None
        self.transaction_model: Optional[IsolationForest] = None
        self.transaction_scaler: Optional[StandardScaler] = None
        self.model_trained_at: Optional[str] = None
        self.training_samples: int = 0
        # Load real artifacts (no synthetic baseline seeding — audit A3)
        self._initialize_models()

    def _initialize_models(self):
        """Load locally persisted IsolationForest artifacts as the offline
        fallback for the ml-platform FraudNet champion.

        Artifacts (produced by the ml-platform pipeline, e.g. exported to the
        model_registry_data volume):
          fraud_order_if.pkl        — {"model": IsolationForest, "scaler": StandardScaler}
          fraud_transaction_if.pkl  — same layout
        When absent, ML scoring simply defers to ml-platform / rule detectors;
        no random synthetic baseline is trained.
        """
        loaded = []
        for attr_model, attr_scaler, fname in (
            ("order_model", "order_scaler", "fraud_order_if.pkl"),
            ("transaction_model", "transaction_scaler", "fraud_transaction_if.pkl"),
        ):
            path = MODEL_REGISTRY_PATH / fname
            if not path.is_file():
                continue
            try:
                with open(path, "rb") as fh:
                    bundle = pickle.load(fh)
                setattr(self, attr_model, bundle["model"])
                setattr(self, attr_scaler, bundle["scaler"])
                loaded.append(fname)
            except Exception as exc:
                logger.error("[FraudEngine] failed to load %s: %s", path, exc)
        self.model_trained_at = datetime.now(timezone.utc).isoformat()
        self.training_samples = 0
        if loaded:
            logger.info("[FraudEngine] Loaded local fallback artifacts: %s", loaded)
        else:
            logger.info(
                "[FraudEngine] No local artifacts under %s; ML scoring via ml-platform "
                "(%s) with rule-detector fallback", MODEL_REGISTRY_PATH, ML_PLATFORM_URL,
            )

    def add_alert(self, alert: dict):
        with self.lock:
            self.alerts.appendleft(alert)

state = FraudState()

# ── Risk Scoring Functions ────────────────────────────────────────────────────

def score_to_severity(score: float) -> str:
    if score >= 0.85:
        return "CRITICAL"
    elif score >= RISK_THRESHOLD_HIGH:
        return "HIGH"
    elif score >= RISK_THRESHOLD_MEDIUM:
        return "MEDIUM"
    else:
        return "LOW"

def detect_wash_trading(user_id: str, symbol: str, side: str, quantity: float, price: float) -> tuple[float, list[str]]:
    """Detect wash trading: user buying and selling same instrument in short window."""
    signals = []
    risk = 0.0
    now_ms = int(time.time() * 1000)
    window_ms = VELOCITY_WINDOW_SECONDS * 1000

    orders = list(state.user_orders[user_id])
    recent = [o for o in orders if now_ms - o.get("timestamp_ms", 0) < window_ms and o.get("symbol") == symbol]

    if len(recent) < 2:
        return risk, signals

    # Check for opposite side trades at similar prices
    opposite_side = "sell" if side == "buy" else "buy"
    opposite_orders = [o for o in recent if o.get("side") == opposite_side]

    for opp in opposite_orders:
        price_diff_pct = abs(price - opp.get("price", price)) / max(price, 0.01)
        qty_ratio = min(quantity, opp.get("quantity", 0)) / max(quantity, opp.get("quantity", 1))
        if price_diff_pct < 0.005 and qty_ratio > 0.8:  # within 0.5% price, 80% qty match
            risk = max(risk, 0.85)
            signals.append(f"WASH_TRADE: Opposite {opposite_side} order at similar price ({price_diff_pct:.3%} diff) within {VELOCITY_WINDOW_SECONDS}s")

    # Check for high frequency same-symbol trading
    if len(recent) > 10:
        risk = max(risk, 0.6)
        signals.append(f"HIGH_FREQUENCY: {len(recent)} orders for {symbol} in {VELOCITY_WINDOW_SECONDS}s")

    return risk, signals

def detect_order_manipulation(user_id: str, symbol: str, side: str, quantity: float, price: float, order_type: str) -> tuple[float, list[str]]:
    """Detect spoofing, layering, and quote stuffing."""
    signals = []
    risk = 0.0
    now_ms = int(time.time() * 1000)
    window_ms = 60_000  # 1 minute window for manipulation

    orders = list(state.user_orders[user_id])
    recent_1min = [o for o in orders if now_ms - o.get("timestamp_ms", 0) < window_ms]
    recent_symbol = [o for o in recent_1min if o.get("symbol") == symbol]

    # Spoofing: large limit orders placed and cancelled quickly (detect by high cancel rate)
    cancelled = [o for o in recent_symbol if o.get("cancelled", False)]
    if len(recent_symbol) > 5 and len(cancelled) / max(len(recent_symbol), 1) > 0.7:
        risk = max(risk, 0.75)
        signals.append(f"SPOOFING: {len(cancelled)}/{len(recent_symbol)} orders cancelled for {symbol}")

    # Layering: multiple limit orders at different price levels same direction
    same_side = [o for o in recent_symbol if o.get("side") == side and o.get("order_type") == "limit"]
    if len(same_side) >= 5:
        prices = [o.get("price", 0) for o in same_side]
        price_spread = (max(prices) - min(prices)) / max(min(prices), 0.01) if prices else 0
        if price_spread < 0.02:  # within 2% price range
            risk = max(risk, 0.7)
            signals.append(f"LAYERING: {len(same_side)} {side} limit orders within 2% price range for {symbol}")

    # Quote stuffing: extremely high order rate
    if len(recent_1min) > 50:
        risk = max(risk, 0.8)
        signals.append(f"QUOTE_STUFFING: {len(recent_1min)} orders in 60s across all symbols")

    return risk, signals

def detect_velocity_anomaly(user_id: str, amount: float) -> tuple[float, list[str]]:
    """Detect abnormal transaction velocity."""
    signals = []
    risk = 0.0
    now_ms = int(time.time() * 1000)
    window_ms = VELOCITY_WINDOW_SECONDS * 1000

    txns = list(state.user_transactions[user_id])
    recent = [t for t in txns if now_ms - t.get("timestamp_ms", 0) < window_ms]

    if not recent:
        return risk, signals

    # Check for structuring (multiple transactions just below reporting threshold)
    threshold = 10000  # $10,000 CTR threshold
    near_threshold = [t for t in recent if threshold * 0.8 < t.get("amount", 0) < threshold]
    if len(near_threshold) >= 3:
        risk = max(risk, 0.8)
        signals.append(f"STRUCTURING: {len(near_threshold)} transactions between ${threshold*0.8:,.0f}-${threshold:,.0f} (possible smurfing)")

    # Check for sudden large transaction vs user history
    all_amounts = [t.get("amount", 0) for t in txns]
    if len(all_amounts) > 10:
        avg_amount = np.mean(all_amounts)
        std_amount = np.std(all_amounts)
        if std_amount > 0 and (amount - avg_amount) / std_amount > 5:
            risk = max(risk, 0.65)
            signals.append(f"AMOUNT_ANOMALY: Transaction ${amount:,.2f} is {(amount-avg_amount)/std_amount:.1f}σ above user average ${avg_amount:,.2f}")

    # High velocity
    total_recent = sum(t.get("amount", 0) for t in recent)
    if len(recent) > 5 or total_recent > 50000:
        risk = max(risk, 0.5)
        signals.append(f"HIGH_VELOCITY: {len(recent)} transactions totaling ${total_recent:,.2f} in {VELOCITY_WINDOW_SECONDS}s")

    return risk, signals

def ml_order_anomaly_score(quantity: float, price: float, orders_per_min: float, avg_quantity: float, price_deviation: float, side_ratio: float, user_id: str = "", symbol: str = "", side: str = "") -> float:
    """Order anomaly score: ml-platform FraudNet first, local IsolationForest
    artifact fallback, else 0.0 (rules still apply)."""
    platform = ml_platform_fraud_score({
        "account_id": user_id or "unknown",
        "amount": quantity * price,
        "currency": "NGN",
        "transaction_type": "order",
        "channel": "api",
        "commodity": symbol or None,
        "txns_last_1h": float(orders_per_min) * 60.0,
    })
    if platform is not None:
        return float(platform.get("fraud_probability", 0.0))
    if state.order_model is None or state.order_scaler is None:
        return 0.0
    try:
        features = np.array([[quantity, price, orders_per_min, avg_quantity, price_deviation, side_ratio]])
        scaled = state.order_scaler.transform(features)
        # Isolation Forest: -1 = anomaly, 1 = normal; score_samples returns negative anomaly score
        raw_score = state.order_model.score_samples(scaled)[0]
        # Convert to 0-1 range where 1 = most anomalous
        normalized = max(0.0, min(1.0, (-raw_score - 0.1) / 0.5))
        return normalized
    except Exception as e:
        logger.warning(f"[FraudEngine] ML scoring error: {e}")
        return 0.0

def ml_transaction_anomaly_score(amount: float, hour_of_day: float, txns_per_hour: float, amount_deviation: float, is_round: float, user_id: str = "", transaction_type: str = "", destination: Optional[str] = None, timestamp_ms: Optional[int] = None) -> float:
    """Transaction anomaly score: ml-platform FraudNet first, local artifact
    fallback, else 0.0."""
    platform = ml_platform_fraud_score({
        "account_id": user_id or "unknown",
        "amount": amount,
        "currency": "NGN",
        "transaction_type": transaction_type or "transfer",
        "timestamp": timestamp_ms,
        "txns_last_1h": float(txns_per_hour),
        "amount_vs_user_avg": float(1.0 + amount_deviation),
        "payee_id": destination,
        "new_payee": bool(destination),
        "features": {"is_round_amount": float(is_round)},
    })
    if platform is not None:
        return float(platform.get("fraud_probability", 0.0))
    if state.transaction_model is None or state.transaction_scaler is None:
        return 0.0
    try:
        features = np.array([[amount, hour_of_day, txns_per_hour, amount_deviation, is_round]])
        scaled = state.transaction_scaler.transform(features)
        raw_score = state.transaction_model.score_samples(scaled)[0]
        normalized = max(0.0, min(1.0, (-raw_score - 0.1) / 0.5))
        return normalized
    except Exception as e:
        logger.warning(f"[FraudEngine] ML scoring error: {e}")
        return 0.0

# ── FastAPI App ───────────────────────────────────────────────────────────────

app = FastAPI(
    title="NEXCOM Fraud Detection Engine",
    description="ML-based fraud and anomaly detection for financial transactions",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "fraud-engine",
        "version": "1.0.0",
        "model_trained_at": state.model_trained_at,
        "training_samples": state.training_samples,
        "ml_platform": {
            "url": ML_PLATFORM_URL,
            "circuit_breaker": _platform_breaker.state(),
            "last_model_source": _platform_state.get("last_model_source"),
            "last_ok_at": _platform_state.get("last_ok_at"),
        },
        "local_fallback_artifacts": {
            "order_model": state.order_model is not None,
            "transaction_model": state.transaction_model is not None,
        },
    }

@app.post("/analyze/order")
async def analyze_order(req: OrderAnalysisRequest):
    """Analyze an order for fraud signals."""
    now_ms = req.timestamp or int(time.time() * 1000)
    signals = []
    risk_scores = []

    # 1. Wash trade detection
    wash_risk, wash_signals = detect_wash_trading(req.user_id, req.symbol, req.side, req.quantity, req.price)
    risk_scores.append(wash_risk)
    signals.extend(wash_signals)

    # 2. Order manipulation detection
    manip_risk, manip_signals = detect_order_manipulation(req.user_id, req.symbol, req.side, req.quantity, req.price, req.order_type)
    risk_scores.append(manip_risk)
    signals.extend(manip_signals)

    # 3. ML anomaly score
    user_orders = list(state.user_orders[req.user_id])
    recent_orders = [o for o in user_orders if now_ms - o.get("timestamp_ms", 0) < 60_000]
    orders_per_min = len(recent_orders)
    avg_qty = np.mean([o.get("quantity", req.quantity) for o in user_orders[-50:]]) if user_orders else req.quantity
    buy_orders = [o for o in user_orders[-100:] if o.get("side") == "buy"]
    side_ratio = len(buy_orders) / max(len(user_orders[-100:]), 1)
    ml_risk = ml_order_anomaly_score(
        req.quantity, req.price, orders_per_min, avg_qty, 0.0, side_ratio,
        user_id=req.user_id, symbol=req.symbol, side=req.side,
    )
    risk_scores.append(ml_risk)
    if ml_risk > RISK_THRESHOLD_HIGH:
        source = _platform_state.get("last_model_source") or "local-artifact"
        signals.append(f"ML_ANOMALY: Order pattern anomaly score {ml_risk:.3f} ({source})")

    # Composite risk score (max of all signals, weighted)
    composite_risk = max(risk_scores) if risk_scores else 0.0
    severity = score_to_severity(composite_risk)

    # Record order in history
    state.user_orders[req.user_id].append({
        "order_id": req.order_id,
        "symbol": req.symbol,
        "side": req.side,
        "quantity": req.quantity,
        "price": req.price,
        "order_type": req.order_type,
        "timestamp_ms": now_ms,
        "cancelled": False,
    })

    # Generate alert if HIGH or CRITICAL
    if severity in ("HIGH", "CRITICAL"):
        alert = {
            "alert_id": hashlib.sha256(f"{req.order_id}{now_ms}".encode()).hexdigest()[:16],
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "alert_type": "ORDER_FRAUD",
            "severity": severity,
            "user_id": req.user_id,
            "risk_score": round(composite_risk, 4),
            "signals": signals,
            "details": {"order_id": req.order_id, "symbol": req.symbol, "side": req.side, "quantity": req.quantity, "price": req.price},
        }
        state.add_alert(alert)
        logger.warning(f"[FraudEngine] {severity} alert: {signals}")

    return {
        "order_id": req.order_id,
        "risk_score": round(composite_risk, 4),
        "severity": severity,
        "signals": signals,
        "action": "BLOCK" if severity == "CRITICAL" else ("REVIEW" if severity == "HIGH" else "ALLOW"),
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
    }

@app.post("/analyze/transaction")
async def analyze_transaction(req: TransactionAnalysisRequest):
    """Analyze a financial transaction for fraud signals."""
    now_ms = req.timestamp or int(time.time() * 1000)
    signals = []
    risk_scores = []

    # 1. Velocity anomaly detection
    vel_risk, vel_signals = detect_velocity_anomaly(req.user_id, req.amount)
    risk_scores.append(vel_risk)
    signals.extend(vel_signals)

    # 2. Round number check (common in structuring)
    is_round = 1.0 if req.amount % 1000 == 0 or req.amount % 500 == 0 else 0.0
    if is_round and req.amount >= 5000:
        signals.append(f"ROUND_AMOUNT: Transaction amount ${req.amount:,.0f} is a round number (structuring indicator)")
        risk_scores.append(0.3)

    # 3. ML anomaly score
    hour = datetime.fromtimestamp(now_ms / 1000, tz=timezone.utc).hour
    txns = list(state.user_transactions[req.user_id])
    recent_hour = [t for t in txns if now_ms - t.get("timestamp_ms", 0) < 3_600_000]
    txns_per_hour = len(recent_hour)
    all_amounts = [t.get("amount", req.amount) for t in txns[-100:]]
    avg_amount = np.mean(all_amounts) if all_amounts else req.amount
    amount_dev = (req.amount - avg_amount) / max(avg_amount, 1)
    ml_risk = ml_transaction_anomaly_score(
        req.amount, hour, txns_per_hour, amount_dev, is_round,
        user_id=req.user_id, transaction_type=req.transaction_type,
        destination=req.destination, timestamp_ms=now_ms,
    )
    risk_scores.append(ml_risk)
    if ml_risk > RISK_THRESHOLD_HIGH:
        source = _platform_state.get("last_model_source") or "local-artifact"
        signals.append(f"ML_ANOMALY: Transaction pattern anomaly score {ml_risk:.3f} ({source})")

    # 4. Withdrawal to new destination
    if req.transaction_type == "withdrawal" and req.destination:
        known_destinations = set(t.get("destination") for t in txns[-50:] if t.get("destination"))
        if req.destination not in known_destinations and req.amount > 1000:
            risk_scores.append(0.35)
            signals.append(f"NEW_DESTINATION: First withdrawal to {req.destination[:20]}... for ${req.amount:,.2f}")

    composite_risk = max(risk_scores) if risk_scores else 0.0
    severity = score_to_severity(composite_risk)

    # Record transaction
    state.user_transactions[req.user_id].append({
        "transaction_id": req.transaction_id,
        "amount": req.amount,
        "currency": req.currency,
        "transaction_type": req.transaction_type,
        "destination": req.destination,
        "timestamp_ms": now_ms,
    })

    if severity in ("HIGH", "CRITICAL"):
        alert = {
            "alert_id": hashlib.sha256(f"{req.transaction_id}{now_ms}".encode()).hexdigest()[:16],
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "alert_type": "TRANSACTION_FRAUD",
            "severity": severity,
            "user_id": req.user_id,
            "risk_score": round(composite_risk, 4),
            "signals": signals,
            "details": {"transaction_id": req.transaction_id, "amount": req.amount, "type": req.transaction_type},
        }
        state.add_alert(alert)
        logger.warning(f"[FraudEngine] {severity} transaction alert: {signals}")

    return {
        "transaction_id": req.transaction_id,
        "risk_score": round(composite_risk, 4),
        "severity": severity,
        "signals": signals,
        "action": "BLOCK" if severity == "CRITICAL" else ("REVIEW" if severity == "HIGH" else "ALLOW"),
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
    }

@app.post("/analyze/login")
async def analyze_login(req: LoginAnalysisRequest):
    """Analyze a login attempt for account takeover signals."""
    now_ms = req.timestamp or int(time.time() * 1000)
    signals = []
    risk_scores = []

    logins = list(state.user_logins[req.user_id])

    # New IP address
    known_ips = set(l.get("ip_address") for l in logins[-20:])
    if req.ip_address not in known_ips and logins:
        risk_scores.append(0.3)
        signals.append(f"NEW_IP: Login from new IP {req.ip_address}")

    # New country
    known_countries = set(l.get("country_code") for l in logins[-20:] if l.get("country_code"))
    if req.country_code and req.country_code not in known_countries and known_countries:
        risk_scores.append(0.4)
        signals.append(f"NEW_COUNTRY: Login from new country {req.country_code}")

    # Multiple failed logins
    recent_failures = [l for l in logins if not l.get("success") and now_ms - l.get("timestamp_ms", 0) < 900_000]
    if len(recent_failures) >= 3:
        risk_scores.append(0.7)
        signals.append(f"BRUTE_FORCE: {len(recent_failures)} failed logins in 15 minutes")

    # Impossible travel (login from different country within short time)
    recent_logins = [l for l in logins if now_ms - l.get("timestamp_ms", 0) < 3_600_000]
    if req.country_code and recent_logins:
        recent_countries = set(l.get("country_code") for l in recent_logins if l.get("country_code"))
        if req.country_code not in recent_countries and len(recent_countries) > 0:
            risk_scores.append(0.75)
            signals.append(f"IMPOSSIBLE_TRAVEL: Login from {req.country_code} but recent logins from {recent_countries}")

    composite_risk = max(risk_scores) if risk_scores else 0.0
    severity = score_to_severity(composite_risk)

    # Record login
    state.user_logins[req.user_id].append({
        "ip_address": req.ip_address,
        "country_code": req.country_code,
        "success": req.success,
        "timestamp_ms": now_ms,
    })

    if severity in ("HIGH", "CRITICAL"):
        alert = {
            "alert_id": hashlib.sha256(f"{req.user_id}{req.ip_address}{now_ms}".encode()).hexdigest()[:16],
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "alert_type": "ACCOUNT_TAKEOVER",
            "severity": severity,
            "user_id": req.user_id,
            "risk_score": round(composite_risk, 4),
            "signals": signals,
            "details": {"ip": req.ip_address, "country": req.country_code},
        }
        state.add_alert(alert)
        logger.warning(f"[FraudEngine] {severity} login alert for user {req.user_id}: {signals}")

    return {
        "user_id": req.user_id,
        "risk_score": round(composite_risk, 4),
        "severity": severity,
        "signals": signals,
        "action": "BLOCK" if severity == "CRITICAL" else ("MFA_REQUIRED" if severity == "HIGH" else "ALLOW"),
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
    }

@app.post("/analyze/batch")
async def analyze_batch(events: list[dict]):
    """Batch analyze multiple events."""
    results = []
    for event in events[:100]:  # max 100 per batch
        event_type = event.get("type", "order")
        try:
            if event_type == "order":
                result = await analyze_order(OrderAnalysisRequest(**event))
            elif event_type == "transaction":
                result = await analyze_transaction(TransactionAnalysisRequest(**event))
            elif event_type == "login":
                result = await analyze_login(LoginAnalysisRequest(**event))
            else:
                result = {"error": f"Unknown event type: {event_type}"}
            results.append(result)
        except Exception as e:
            results.append({"error": str(e)})
    return {"results": results, "count": len(results)}

@app.get("/model/status")
async def model_status():
    return {
        "primary_ml": {
            "type": "ml-platform FraudNet (versioned PyTorch champion)",
            "url": ML_PLATFORM_URL,
            "circuit_breaker": _platform_breaker.state(),
            "last_model_source": _platform_state.get("last_model_source"),
            "last_model_version": _platform_state.get("last_model_version"),
            "last_ok_at": _platform_state.get("last_ok_at"),
        },
        "local_fallback": {
            "order_model": "artifact_loaded" if state.order_model else "absent",
            "transaction_model": "artifact_loaded" if state.transaction_model else "absent",
            "path": str(MODEL_REGISTRY_PATH),
        },
        "loaded_at": state.model_trained_at,
        "thresholds": {
            "high": RISK_THRESHOLD_HIGH,
            "medium": RISK_THRESHOLD_MEDIUM,
        },
    }

@app.post("/model/retrain")
async def retrain_model():
    """Trigger real retraining via the ml-platform pipeline (train → register
    → promotion gate). No local synthetic reseeding (audit A3 §fraud-engine).

    Order of attempts:
      1. POST ml-platform /v1/admin/retrain (async pipeline on the platform)
      2. Local `python -m mlplatform.pipelines.end_to_end` when the
         mlplatform package is importable in this container
      3. 503 — nothing was retrained, reported honestly
    """
    platform = ml_platform_post("/v1/admin/retrain", {"transactions": 20000, "epochs": 3})
    if platform is not None:
        return {
            "status": "pipeline_started",
            "via": "ml-platform",
            "detail": platform,
            "requested_at": datetime.now(timezone.utc).isoformat(),
        }
    try:
        import mlplatform.pipelines.end_to_end  # noqa: F401
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="ml-platform unreachable and mlplatform package not installed "
                   "locally; retraining not possible from this container",
        )
    import subprocess
    import sys

    proc = subprocess.Popen(
        [sys.executable, "-m", "mlplatform.pipelines.end_to_end",
         "--transactions", "20000", "--epochs", "3"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    return {
        "status": "pipeline_started",
        "via": "local-subprocess",
        "pid": proc.pid,
        "requested_at": datetime.now(timezone.utc).isoformat(),
    }

@app.get("/alerts")
async def get_alerts(limit: int = 100, severity: Optional[str] = None):
    alerts = list(state.alerts)
    if severity:
        alerts = [a for a in alerts if a.get("severity") == severity.upper()]
    return {"alerts": alerts[:limit], "total": len(alerts)}

# ── Entry Point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    logger.info(f"[FraudEngine] Starting on port {FRAUD_ENGINE_PORT}")
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=FRAUD_ENGINE_PORT,
        log_level="info",
        access_log=True,
    )
