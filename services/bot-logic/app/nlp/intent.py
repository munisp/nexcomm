"""
NEXCOM Bot Logic — NLP Intent Classifier
=========================================
Rule-based intent classification with confidence scoring.
No external ML dependencies required — uses keyword matching + regex.

For production, this can be swapped with a fine-tuned model
(e.g., spaCy, HuggingFace transformers) without changing the interface.

Intents:
  PRICE_CHECK     — "price maize", "how much is sorghum"
  PORTFOLIO       — "my portfolio", "positions", "holdings"
  TRADE_BUY       — "buy 10 maize", "purchase sorghum"
  TRADE_SELL      — "sell 5 cocoa", "offload cotton"
  LOAN_STATUS     — "my loan", "loan balance", "repayment"
  LOAN_APPLY      — "apply for loan", "need financing"
  ALERT_SET       — "alert me when maize hits 50000"
  ALERT_LIST      — "alert list", "show my alerts", "my alerts"
  ALERT_DELETE    — "alert delete 42", "remove alert 7"
  MARKET_NEWS     — "news", "market update"
  HELP            — "help", "what can you do"
  GREETING        — "hi", "hello", "good morning"
  ACCOUNT_LINK    — "link account", "verify", "connect"
  UNKNOWN         — fallback
"""

import re
from dataclasses import dataclass
from typing import Optional


COMMODITIES = [
    "maize", "corn", "sorghum", "soybeans", "soy", "sesame",
    "cocoa", "cotton", "ginger", "groundnut", "peanut",
    "wheat", "rice", "cassava", "yam", "palm oil", "cashew",
]

COMMODITY_SYMBOLS = {
    "maize": "MAIZE", "corn": "MAIZE",
    "sorghum": "SORGHUM",
    "soybeans": "SOYBEANS", "soy": "SOYBEANS",
    "sesame": "SESAME",
    "cocoa": "COCOA",
    "cotton": "COTTON",
    "ginger": "GINGER",
    "groundnut": "GROUNDNUT", "peanut": "GROUNDNUT",
    "wheat": "WHEAT",
    "rice": "RICE",
    "cassava": "CASSAVA",
    "yam": "YAM",
    "palm oil": "PALMOIL",
    "cashew": "CASHEW",
}


@dataclass
class Intent:
    name: str
    confidence: float
    entities: dict


def classify(text: str) -> Intent:
    """Classify the intent of a message with confidence score and extracted entities."""
    text_lower = text.lower().strip()
    entities = {}

    # Extract commodity mention
    commodity = _extract_commodity(text_lower)
    if commodity:
        entities["commodity"] = commodity
        entities["symbol"] = COMMODITY_SYMBOLS.get(commodity, commodity.upper())

    # Extract quantity
    qty = _extract_quantity(text_lower)
    if qty:
        entities["quantity"] = qty

    # Extract price
    price = _extract_price(text_lower)
    if price:
        entities["price"] = price

    # ─── Rule matching ────────────────────────────────────────────────────────

    # GREETING
    if re.search(r"^(hi|hello|hey|good (morning|afternoon|evening)|howdy|sup)\b", text_lower):
        return Intent("GREETING", 0.95, entities)

    # HELP
    if re.search(r"\b(help|what can|commands|options|menu)\b", text_lower):
        return Intent("HELP", 0.95, entities)

    # PRICE_CHECK
    if re.search(r"\b(price|cost|rate|how much|value|worth|quote)\b", text_lower):
        if commodity:
            return Intent("PRICE_CHECK", 0.92, entities)
        return Intent("PRICE_CHECK", 0.75, entities)

    # TRADE_BUY
    if re.search(r"\b(buy|purchase|acquire|order|bid)\b", text_lower):
        if commodity and qty:
            return Intent("TRADE_BUY", 0.90, entities)
        return Intent("TRADE_BUY", 0.70, entities)

    # TRADE_SELL
    if re.search(r"\b(sell|offload|dispose|offer|ask)\b", text_lower):
        if commodity and qty:
            return Intent("TRADE_SELL", 0.90, entities)
        return Intent("TRADE_SELL", 0.70, entities)

    # LOAN_STATUS / LOAN_APPLY (check before PORTFOLIO to avoid 'balance' collision)
    if re.search(r"\b(loan|credit|repay|repayment|due|outstanding|borrow|financing|finance)\b", text_lower):
        if re.search(r"\b(apply|get|need|want|request|i need)\b", text_lower):
            return Intent("LOAN_APPLY", 0.85, entities)
        return Intent("LOAN_STATUS", 0.88, entities)

    # ACCOUNT_LINK (check before PORTFOLIO to avoid 'account' collision)
    if re.search(r"\b(link|connect|verify|sign up|create account)\b", text_lower):
        return Intent("ACCOUNT_LINK", 0.88, entities)

    # PORTFOLIO
    if re.search(r"\b(portfolio|positions?|holdings?|my stock|my asset)\b", text_lower):
        return Intent("PORTFOLIO", 0.88, entities)
    # 'balance' or 'account' alone → PORTFOLIO
    if re.search(r"\b(balance|my account|account balance)\b", text_lower):
        return Intent("PORTFOLIO", 0.80, entities)

    # ALERT_DELETE — must come before ALERT_SET/LIST to catch '/alert delete 42'
    if re.search(r"\b(alert\s+delete|delete\s+alert|remove\s+alert|cancel\s+alert)\b", text_lower):
        alert_id = _extract_alert_id(text_lower)
        if alert_id:
            entities["alert_id"] = alert_id
        return Intent("ALERT_DELETE", 0.93, entities)

    # ALERT_LIST — '/alert list', 'list alerts', 'show alerts', 'my alerts'
    if re.search(r"\b(alert\s+list|list\s+alerts?|show\s+alerts?|my\s+alerts?|view\s+alerts?)\b", text_lower):
        return Intent("ALERT_LIST", 0.93, entities)

    # ALERT_SET — '/alert set SYMBOL PRICE', 'alert MAIZE 50000'
    if re.search(r"\b(alert|notify|notification|remind|watch|monitor)\b", text_lower):
        condition = _extract_condition(text_lower)
        if condition:
            entities["condition"] = condition
        if commodity and price:
            return Intent("ALERT_SET", 0.90, entities)
        return Intent("ALERT_SET", 0.72, entities)

    # MARKET_NEWS
    if re.search(r"\b(news|update|report|market|latest|trend)\b", text_lower):
        return Intent("MARKET_NEWS", 0.82, entities)

    # Commodity mention without clear intent → price check
    if commodity:
        return Intent("PRICE_CHECK", 0.60, entities)

    return Intent("UNKNOWN", 0.30, entities)


def _extract_commodity(text: str) -> Optional[str]:
    """Extract commodity name from text."""
    for commodity in sorted(COMMODITIES, key=len, reverse=True):
        if commodity in text:
            return commodity
    # Check for uppercase symbols like MAIZE, SOYBEANS
    for symbol in COMMODITY_SYMBOLS.values():
        if symbol.lower() in text:
            for k, v in COMMODITY_SYMBOLS.items():
                if v == symbol:
                    return k
    return None


def _extract_quantity(text: str) -> Optional[float]:
    """Extract numeric quantity from text (e.g. '10 MT', '5 tonnes')."""
    match = re.search(r"(\d+(?:\.\d+)?)\s*(?:mt|tonnes?|bags?|kg|tons?)?", text)
    if match:
        return float(match.group(1))
    return None


def _extract_alert_id(text: str) -> Optional[int]:
    """Extract alert ID from text (e.g. 'delete 42', 'alert delete 7')."""
    # Pattern: delete/remove/cancel [alert] <number>
    match = re.search(r"(?:delete|remove|cancel)\s+(?:alert\s+)?(\d+)", text)
    if match:
        return int(match.group(1))
    # Pattern: alert delete <number>
    match = re.search(r"alert\s+delete\s+(\d+)", text)
    if match:
        return int(match.group(1))
    return None


def _extract_condition(text: str) -> Optional[str]:
    """Extract alert condition from text (ABOVE, BELOW, CROSS_ABOVE, CROSS_BELOW)."""
    if re.search(r"\bcross\s+above\b", text):
        return "CROSS_ABOVE"
    if re.search(r"\bcross\s+below\b", text):
        return "CROSS_BELOW"
    if re.search(r"\b(above|over|exceed|higher than|rises?\s+above|goes?\s+above)\b", text):
        return "ABOVE"
    if re.search(r"\b(below|under|lower than|falls?\s+below|drops?\s+below|goes?\s+below)\b", text):
        return "BELOW"
    return None


def _extract_price(text: str) -> Optional[float]:
    """Extract price from text (e.g. '50000', '₦50,000', '$500')."""
    # First try: currency symbol followed by number
    match = re.search(r"[₦$₦]\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{4,}(?:\.\d+)?)", text)
    if match:
        return float(match.group(1).replace(",", ""))
    # Second try: bare large number (4+ digits, not a quantity)
    match = re.search(r"\b(\d{4,}(?:,\d{3})*(?:\.\d+)?)\b", text)
    if match:
        return float(match.group(1).replace(",", ""))
    return None
