"""
Tests for the NEXCOM Bot Logic NLP intent classifier.
Run with: pytest tests/test_intent.py -v
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.nlp.intent import classify


def test_greeting():
    assert classify("hi").name == "GREETING"
    assert classify("hello there").name == "GREETING"
    assert classify("good morning").name == "GREETING"


def test_help():
    assert classify("help").name == "HELP"
    assert classify("what can you do").name == "HELP"
    assert classify("show commands").name == "HELP"


def test_price_check():
    r = classify("price maize")
    assert r.name == "PRICE_CHECK"
    assert r.entities.get("symbol") == "MAIZE"
    assert r.confidence >= 0.9

    r2 = classify("how much is sorghum today")
    assert r2.name == "PRICE_CHECK"
    assert r2.entities.get("symbol") == "SORGHUM"


def test_trade_buy():
    r = classify("buy 10 maize")
    assert r.name == "TRADE_BUY"
    assert r.entities.get("symbol") == "MAIZE"
    assert r.entities.get("quantity") == 10.0


def test_trade_sell():
    r = classify("sell 5 cocoa")
    assert r.name == "TRADE_SELL"
    assert r.entities.get("symbol") == "COCOA"
    assert r.entities.get("quantity") == 5.0


def test_portfolio():
    assert classify("my portfolio").name == "PORTFOLIO"
    assert classify("show my positions").name == "PORTFOLIO"
    assert classify("account balance").name == "PORTFOLIO"


def test_loan_status():
    assert classify("my loan").name == "LOAN_STATUS"
    assert classify("loan balance").name == "LOAN_STATUS"
    assert classify("repayment due").name == "LOAN_STATUS"


def test_loan_apply():
    assert classify("apply for loan").name == "LOAN_APPLY"
    assert classify("I need financing").name == "LOAN_APPLY"


def test_alert_set():
    r = classify("alert me when maize hits 50000")
    assert r.name == "ALERT_SET"
    assert r.entities.get("symbol") == "MAIZE"
    assert r.entities.get("price") == 50000.0


def test_market_news():
    assert classify("latest market news").name == "MARKET_NEWS"
    assert classify("market update").name == "MARKET_NEWS"


def test_account_link():
    assert classify("link my account").name == "ACCOUNT_LINK"
    assert classify("verify my account").name == "ACCOUNT_LINK"


def test_unknown():
    r = classify("random gibberish xyz123")
    assert r.name == "UNKNOWN"
    assert r.confidence < 0.5


def test_commodity_extraction():
    r = classify("price soybeans")
    assert r.entities.get("symbol") == "SOYBEANS"

    r2 = classify("price GINGER")
    assert r2.entities.get("symbol") == "GINGER"


def test_price_extraction():
    r = classify("alert maize ₦50,000")
    assert r.entities.get("price") == 50000.0


def test_quantity_extraction():
    r = classify("buy 25.5 MT cotton")
    assert r.entities.get("quantity") == 25.5
