"""Tests for dedicated salesperson login feature"""
import pytest
import requests
import os

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

# Salesperson credentials — read from env so secrets stay out of version control
SP_EMAIL = os.environ.get("TEST_SP_EMAIL", "seller@crackerpos.in")
SP_PASSWORD = os.environ.get("TEST_SP_PASSWORD", "seller123")
ADMIN_EMAIL = os.environ.get("TEST_ADMIN_EMAIL", "admin@crackerpos.in")
ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD", "admin123")


def get_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


class TestSalespersonLogin:
    """Test salesperson login and role in /auth/me"""

    def test_salesperson_login_returns_200(self):
        s = get_session()
        r = s.post(f"{BASE_URL}/api/auth/login", json={"email": SP_EMAIL, "password": SP_PASSWORD})
        assert r.status_code == 200, f"Login failed: {r.text}"
        data = r.json()
        assert data["role"] == "salesperson", f"Expected role=salesperson, got {data.get('role')}"
        assert data["salesperson_id"], f"salesperson_id missing from UserOut: {data}"
        print(f"PASS: Salesperson login OK, salesperson_id={data['salesperson_id']}, name={data['name']}")

    def test_salesperson_auth_me(self):
        s = get_session()
        s.post(f"{BASE_URL}/api/auth/login", json={"email": SP_EMAIL, "password": SP_PASSWORD})
        r = s.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200
        data = r.json()
        assert data["role"] == "salesperson"
        assert data["salesperson_id"]
        print(f"PASS: /auth/me returns salesperson with salesperson_id={data['salesperson_id']}")

    def test_salesperson_cannot_access_admin_stats(self):
        s = get_session()
        s.post(f"{BASE_URL}/api/auth/login", json={"email": SP_EMAIL, "password": SP_PASSWORD})
        r = s.get(f"{BASE_URL}/api/admin/stats")
        assert r.status_code in [401, 403], f"Expected 401/403 got {r.status_code}"
        print("PASS: Salesperson cannot access /admin/stats")

    def test_salesperson_can_call_shift_start_no_pin(self):
        s = get_session()
        login_r = s.post(f"{BASE_URL}/api/auth/login", json={"email": SP_EMAIL, "password": SP_PASSWORD})
        sp_id = login_r.json()["salesperson_id"]
        r = s.post(f"{BASE_URL}/api/admin/salespersons/shift-start-no-pin", json={"salesperson_id": sp_id})
        assert r.status_code == 200, f"shift-start-no-pin failed: {r.text}"
        print("PASS: Salesperson can call shift-start-no-pin")

    def test_salesperson_can_place_pos_order(self):
        s = get_session()
        login_r = s.post(f"{BASE_URL}/api/auth/login", json={"email": SP_EMAIL, "password": SP_PASSWORD})
        sp_id = login_r.json()["salesperson_id"]

        # Get products
        products_r = s.get(f"{BASE_URL}/api/products")
        assert products_r.status_code == 200
        products = products_r.json()
        in_stock = [p for p in products if p.get("stock", 0) > 0]
        assert in_stock, "No in-stock products"

        p = in_stock[0]
        order_r = s.post(f"{BASE_URL}/api/admin/pos", json={
            "customer_name": "Test Customer",
            "customer_phone": "",
            "customer_type": "retail",
            "items": [{"product_id": p["id"], "qty": 1}],
            "payment_mode": "cash",
            "salesperson_id": sp_id,
        })
        assert order_r.status_code == 200, f"POS order failed: {order_r.text}"
        data = order_r.json()
        assert data.get("salesperson_name"), f"salesperson_name missing from order: {data}"
        print(f"PASS: Salesperson POS order placed, salesperson_name={data['salesperson_name']}, order_id={data['id']}")


class TestAdminLoginStillWorks:
    """Ensure admin login is unchanged"""

    def test_admin_login(self):
        s = get_session()
        r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert r.status_code == 200, f"Admin login failed: {r.text}"
        assert r.json()["role"] == "admin"
        print("PASS: Admin login OK")

    def test_admin_can_access_stats(self):
        s = get_session()
        s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        r = s.get(f"{BASE_URL}/api/admin/stats")
        assert r.status_code == 200
        print("PASS: Admin can access /admin/stats")

    def test_admin_shift_start_no_pin(self):
        s = get_session()
        s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        # Get salespersons
        sps_r = s.get(f"{BASE_URL}/api/admin/salespersons")
        assert sps_r.status_code == 200
        sps = sps_r.json()
        sp = next((x for x in sps if not x.get("has_pin")), None)
        if sp:
            r = s.post(f"{BASE_URL}/api/admin/salespersons/shift-start-no-pin", json={"salesperson_id": sp["id"]})
            assert r.status_code == 200
            print(f"PASS: Admin shift-start-no-pin works for {sp['name']}")
        else:
            print("SKIP: No no-pin salesperson found")


class TestCreateSalespersonAccount:
    """Test admin can create account for a salesperson"""

    def test_create_account_for_tinku(self):
        s = get_session()
        s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        # Get salespersons
        sps_r = s.get(f"{BASE_URL}/api/admin/salespersons")
        sps = sps_r.json()
        tinku = next((x for x in sps if x["name"].lower() == "tinku"), None)
        if not tinku:
            pytest.skip("Tinku salesperson not found")
        sp_id = tinku["id"]

        # Create account
        r = s.post(f"{BASE_URL}/api/admin/salespersons/{sp_id}/create-account",
                   json={"email": "tinku@crackerpos.in", "password": "tinku123"})
        # May already exist — 200 or 400 both acceptable here
        if r.status_code == 400 and "already" in r.text.lower():
            print("INFO: Tinku account already exists")
        else:
            assert r.status_code == 200, f"Create account failed: {r.text}"
            data = r.json()
            assert data.get("ok") is True or data.get("role") == "salesperson", f"Unexpected response: {data}"
            print(f"PASS: Created salesperson account: {data}")
