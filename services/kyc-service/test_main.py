"""Tests for KYC/KYB service."""
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from main import app
    return TestClient(app)


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "healthy"
    assert data["service"] == "kyc-kyb"
    assert "engines" in data
    assert data["stats"]["kyc_applications"] >= 5
    assert data["stats"]["kyb_applications"] >= 3


def test_kyc_stats(client):
    r = client.get("/api/v1/kyc/stats")
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["total_kyc"] >= 5
    assert data["total_kyb"] >= 3
    assert "kyc_by_status" in data
    assert "pending_review" in data


def test_stakeholder_types(client):
    r = client.get("/api/v1/onboarding/stakeholder-types")
    assert r.status_code == 200
    types = r.json()["data"]
    assert len(types) == 7
    names = [t["id"] for t in types]
    assert "retail_trader" in names
    assert "broker_dealer" in names
    assert "market_maker" in names


def test_onboarding_requirements(client):
    r = client.get("/api/v1/onboarding/requirements/retail_trader")
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["needs_kyb"] is False
    assert "government_id" in data["kyc_steps"]
    assert "selfie_liveness" in data["kyc_steps"]

    r2 = client.get("/api/v1/onboarding/requirements/broker_dealer")
    data2 = r2.json()["data"]
    assert data2["needs_kyb"] is True
    assert len(data2["kyb_documents"]) > 0


def test_list_kyc_applications(client):
    r = client.get("/api/v1/kyc/applications")
    assert r.status_code == 200
    data = r.json()
    assert data["total"] >= 5
    assert len(data["data"]) >= 5


def test_get_kyc_application(client):
    r = client.get("/api/v1/kyc/applications/kyc-001")
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["full_name"] == "Adeyemi Oluwaseun"
    assert data["status"] == "approved"


def test_create_kyc_application(client):
    r = client.post("/api/v1/kyc/applications", json={
        "account_id": "ACC-TEST",
        "stakeholder_type": "retail_trader",
        "full_name": "Test User",
        "email": "test@example.com",
        "phone_number": "+234-800-000-0000",
    })
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["status"] == "pending"
    assert data["full_name"] == "Test User"


def test_filter_kyc_by_status(client):
    r = client.get("/api/v1/kyc/applications?status=approved")
    assert r.status_code == 200
    for app in r.json()["data"]:
        assert app["status"] == "approved"


def test_list_kyb_applications(client):
    r = client.get("/api/v1/kyb/applications")
    assert r.status_code == 200
    assert r.json()["total"] >= 3


def test_get_kyb_application(client):
    r = client.get("/api/v1/kyb/applications/kyb-001")
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["business_name"] == "Stanbic Securities Ltd"
    assert data["status"] == "approved"


def test_create_kyb_application(client):
    r = client.post("/api/v1/kyb/applications", json={
        "account_id": "ACC-BIZ-TEST",
        "stakeholder_type": "broker_dealer",
        "business_name": "Test Brokerage Ltd",
        "registration_number": "RC-9999999",
        "industry": "Securities Trading",
    })
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["status"] == "pending"


def test_review_kyc_approve(client):
    r = client.post("/api/v1/kyc/applications/kyc-003/review", json={
        "reviewer_id": "ADMIN-001",
        "decision": "approve",
        "notes": "All documents verified",
    })
    assert r.status_code == 200
    assert r.json()["data"]["status"] == "approved"


def test_review_kyc_reject(client):
    r = client.post("/api/v1/kyc/applications/kyc-004/review", json={
        "reviewer_id": "ADMIN-001",
        "decision": "reject",
        "notes": "Incomplete documents",
        "rejection_reason": "Missing proof of address",
    })
    assert r.status_code == 200
    assert r.json()["data"]["status"] == "rejected"


def test_liveness_start(client):
    r = client.post("/api/v1/kyc/applications/kyc-004/liveness/start?num_challenges=3")
    assert r.status_code == 200
    data = r.json()["data"]
    assert "session_id" in data
    assert len(data["challenges"]) == 3
    assert data["total_challenges"] == 3


def test_404_kyc(client):
    r = client.get("/api/v1/kyc/applications/nonexistent")
    assert r.status_code == 404


def test_404_kyb(client):
    r = client.get("/api/v1/kyb/applications/nonexistent")
    assert r.status_code == 404
