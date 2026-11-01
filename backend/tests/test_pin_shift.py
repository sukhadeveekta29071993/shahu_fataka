"""Tests for Salesperson PIN shift system"""
import pytest
import requests
import os

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

@pytest.fixture
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    # Login as admin
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": "admin@crackerpos.in", "password": "admin123"})
    assert r.status_code == 200, f"Admin login failed: {r.text}"
    return s

class TestSalespersonPIN:
    """Tests for PIN management"""

    def test_list_salespersons(self, session):
        r = session.get(f"{BASE_URL}/api/admin/salespersons")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        print(f"PASS: List salespersons returns {len(data)} items")
        # Print names and has_pin
        for sp in data:
            print(f"  - {sp['name']}: has_pin={sp['has_pin']}, id={sp['id']}")

    def test_ravi_kumar_has_pin(self, session):
        r = session.get(f"{BASE_URL}/api/admin/salespersons")
        assert r.status_code == 200
        sps = r.json()
        ravi = next((s for s in sps if s["name"] == "Ravi Kumar"), None)
        assert ravi is not None, "Ravi Kumar not found"
        assert ravi["has_pin"] == True, f"Ravi Kumar should have PIN set, got has_pin={ravi['has_pin']}"
        print(f"PASS: Ravi Kumar has PIN set (id={ravi['id']})")

    def test_set_pin_invalid(self, session):
        r = session.get(f"{BASE_URL}/api/admin/salespersons")
        sps = r.json()
        sp_id = sps[0]["id"]
        # Try 3 digit PIN
        r2 = session.patch(f"{BASE_URL}/api/admin/salespersons/{sp_id}/pin", json={"pin": "123"})
        assert r2.status_code == 400, f"Expected 400 for 3-digit PIN, got {r2.status_code}"
        print("PASS: 3-digit PIN returns 400")
        # Try letters
        r3 = session.patch(f"{BASE_URL}/api/admin/salespersons/{sp_id}/pin", json={"pin": "abcd"})
        assert r3.status_code == 400
        print("PASS: Letter PIN returns 400")

    def test_create_and_set_pin(self, session):
        # Create test salesperson
        r = session.post(f"{BASE_URL}/api/admin/salespersons", json={"name": "TEST_PinTest"})
        assert r.status_code == 200
        sp = r.json()
        sp_id = sp["id"]
        assert sp["has_pin"] == False
        print(f"PASS: Created TEST_PinTest (id={sp_id}), has_pin=False")

        # Set PIN
        r2 = session.patch(f"{BASE_URL}/api/admin/salespersons/{sp_id}/pin", json={"pin": "5678"})
        assert r2.status_code == 200
        print("PASS: PIN set successfully")

        # Verify in list
        r3 = session.get(f"{BASE_URL}/api/admin/salespersons")
        sps = r3.json()
        updated = next((s for s in sps if s["id"] == sp_id), None)
        assert updated is not None
        assert updated["has_pin"] == True
        print("PASS: has_pin updated to True after setting PIN")

        # Cleanup
        session.delete(f"{BASE_URL}/api/admin/salespersons/{sp_id}")

    def test_verify_pin_correct(self, session):
        r = session.get(f"{BASE_URL}/api/admin/salespersons")
        sps = r.json()
        ravi = next((s for s in sps if s["name"] == "Ravi Kumar"), None)
        assert ravi is not None
        r2 = session.post(f"{BASE_URL}/api/admin/salespersons/verify-pin", json={"salesperson_id": ravi["id"], "pin": "1234"})
        assert r2.status_code == 200, f"Expected 200 for correct PIN, got {r2.status_code}: {r2.text}"
        print("PASS: Correct PIN (1234) verified for Ravi Kumar")

    def test_verify_pin_wrong(self, session):
        r = session.get(f"{BASE_URL}/api/admin/salespersons")
        sps = r.json()
        ravi = next((s for s in sps if s["name"] == "Ravi Kumar"), None)
        assert ravi is not None
        r2 = session.post(f"{BASE_URL}/api/admin/salespersons/verify-pin", json={"salesperson_id": ravi["id"], "pin": "9999"})
        assert r2.status_code == 401, f"Expected 401 for wrong PIN, got {r2.status_code}"
        print("PASS: Wrong PIN returns 401")

    def test_salesperson_report_endpoint(self, session):
        r = session.get(f"{BASE_URL}/api/admin/reports/salesperson")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        print(f"PASS: Salesperson report returns {len(data)} entries")
        for entry in data:
            print(f"  - {entry.get('name')}: orders={entry.get('total_orders')}, revenue={entry.get('total_revenue')}")
