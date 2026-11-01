"""Backend tests for Admin Phase 2 features: stats, orders, wholesale, POS"""
import pytest
import requests
import os

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

def get_admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": "admin@crackerpos.in", "password": "admin123"})
    assert r.status_code == 200, f"Admin login failed: {r.text}"
    return r.json().get("token") or r.cookies.get("token")

def get_demo_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": "demo@crackerpos.in", "password": "demo1234"})
    assert r.status_code == 200
    return r.json().get("token") or r.cookies.get("token")

@pytest.fixture(scope="module")
def admin_headers():
    token = get_admin_token()
    if token:
        return {"Authorization": f"Bearer {token}"}
    return {}

@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": "admin@crackerpos.in", "password": "admin123"})
    assert r.status_code == 200
    return s

@pytest.fixture(scope="module")
def demo_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": "demo@crackerpos.in", "password": "demo1234"})
    assert r.status_code == 200
    return s

# --- Auth: role field returned ---
class TestAuthRole:
    def test_admin_login_returns_role(self):
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": "admin@crackerpos.in", "password": "admin123"})
        assert r.status_code == 200
        data = r.json()
        assert "role" in data
        assert data["role"] == "admin"

    def test_demo_login_returns_role(self):
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": "demo@crackerpos.in", "password": "demo1234"})
        assert r.status_code == 200
        data = r.json()
        assert "role" in data

# --- Admin stats ---
class TestAdminStats:
    def test_stats_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/admin/stats")
        assert r.status_code in [401, 403]

    def test_stats_ok_for_admin(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/admin/stats")
        assert r.status_code == 200
        data = r.json()
        assert "today_revenue" in data
        assert "today_orders" in data
        assert "total_orders" in data
        assert "pending_wholesale" in data

    def test_stats_denied_for_non_admin(self, demo_session):
        r = demo_session.get(f"{BASE_URL}/api/admin/stats")
        assert r.status_code in [401, 403]

# --- Admin orders ---
class TestAdminOrders:
    def test_orders_ok_for_admin(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/admin/orders")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)

    def test_orders_denied_for_non_admin(self, demo_session):
        r = demo_session.get(f"{BASE_URL}/api/admin/orders")
        assert r.status_code in [401, 403]

# --- Admin wholesale ---
class TestAdminWholesale:
    def test_wholesale_list_ok(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/admin/wholesale")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)

    def test_wholesale_has_expected_fields(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/admin/wholesale")
        assert r.status_code == 200
        data = r.json()
        if len(data) > 0:
            u = data[0]
            assert "id" in u
            assert "name" in u
            assert "email" in u

    def test_wholesale_approve(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/admin/wholesale")
        users = r.json()
        # Find a pending wholesale user
        pending = [u for u in users if not u.get("approved") and not u.get("rejected")]
        if not pending:
            pytest.skip("No pending wholesale users")
        uid = pending[0]["id"]
        r2 = admin_session.patch(f"{BASE_URL}/api/admin/wholesale/{uid}/approve")
        assert r2.status_code == 200
        # Verify status changed
        r3 = admin_session.get(f"{BASE_URL}/api/admin/wholesale")
        approved = [u for u in r3.json() if u["id"] == uid]
        assert approved[0]["approved"] is True

# --- Admin POS ---
class TestAdminPOS:
    def test_pos_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/admin/pos", json={})
        assert r.status_code in [401, 403]

    def test_pos_place_order(self, admin_session):
        # Get a valid product
        r = admin_session.get(f"{BASE_URL}/api/products")
        assert r.status_code == 200
        products = r.json()
        assert len(products) > 0
        p = products[0]

        payload = {
            "customer_name": "TEST_Walk-in",
            "customer_phone": "9876543210",
            "customer_type": "retail",
            "payment_mode": "cash",
            "items": [{"product_id": p["id"], "qty": 1}]
        }
        r2 = admin_session.post(f"{BASE_URL}/api/admin/pos", json=payload)
        assert r2.status_code == 200, f"POS order failed: {r2.text}"
        data = r2.json()
        assert "id" in data
        assert data.get("is_pos") is True
        assert data.get("customer_name") == "TEST_Walk-in"

    def test_pos_denied_for_non_admin(self, demo_session):
        r = demo_session.post(f"{BASE_URL}/api/admin/pos", json={"items": []})
        assert r.status_code in [401, 403]
