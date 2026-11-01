"""Tests for shift logs, auth refresh, and export CSV-related APIs"""
import pytest
import requests
import os

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": "admin@crackerpos.in", "password": "admin123"})
    assert r.status_code == 200, f"Login failed: {r.text}"
    return s


def test_auth_refresh(session):
    r = session.post(f"{BASE_URL}/api/auth/refresh")
    assert r.status_code == 200
    data = r.json()
    assert "ok" in data or "access_token" in data or r.status_code == 200


def test_get_shift_logs(session):
    r = session.get(f"{BASE_URL}/api/admin/shift-logs")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)


def test_get_shift_logs_today_filter(session):
    from datetime import date
    today = date.today().isoformat()
    r = session.get(f"{BASE_URL}/api/admin/shift-logs?from_date={today}&to_date={today}")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_shift_start_no_pin(session):
    # Get a salesperson id first
    sps = session.get(f"{BASE_URL}/api/admin/salespersons").json()
    sp = next((s for s in sps if not s.get("has_pin")), sps[0] if sps else None)
    if not sp:
        pytest.skip("No salespersons available")
    r = session.post(f"{BASE_URL}/api/admin/salespersons/shift-start-no-pin", json={"salesperson_id": sp["id"]})
    assert r.status_code in [200, 201]


def test_shift_end(session):
    sps = session.get(f"{BASE_URL}/api/admin/salespersons").json()
    sp = next((s for s in sps if not s.get("has_pin")), sps[0] if sps else None)
    if not sp:
        pytest.skip("No salespersons available")
    r = session.post(f"{BASE_URL}/api/admin/salespersons/shift-end", json={"salesperson_id": sp["id"]})
    assert r.status_code in [200, 201]


def test_salesperson_report_for_csv(session):
    r = session.get(f"{BASE_URL}/api/admin/reports/salesperson")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    if data:
        assert "name" in data[0]
        assert "orders" in data[0]
        assert "revenue" in data[0]


def test_add_category_authenticated(session):
    """Bug fix: admin can add category without 'Not authenticated' error"""
    r2 = session.post(f"{BASE_URL}/api/admin/categories", json={"name": "TEST_ShiftTestCat"})
    assert r2.status_code in [200, 201], f"Failed to add category: {r2.text}"
    cat_id = r2.json().get("id")
    # Cleanup via rename attempt (no delete endpoint visible, just verify creation worked)
    assert cat_id is not None
