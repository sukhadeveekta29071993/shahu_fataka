"""Backend tests for Stock Restock feature: PATCH /api/admin/products/{id}/stock"""
import pytest
import requests
import os

def _load_base_url():
    url = os.environ.get("REACT_APP_BACKEND_URL", "")
    if not url:
        env_path = os.path.join(os.path.dirname(__file__), "../../../frontend/.env")
        if os.path.exists(env_path):
            for line in open(env_path):
                if line.startswith("REACT_APP_BACKEND_URL="):
                    url = line.split("=", 1)[1].strip()
    return url.rstrip("/")

BASE_URL = _load_base_url()

@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": "admin@crackerpos.in", "password": "admin123"})
    assert r.status_code == 200, f"Admin login failed: {r.text}"
    return s

@pytest.fixture(scope="module")
def demo_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": "demo@crackerpos.in", "password": "demo1234"})
    assert r.status_code == 200, f"Demo login failed: {r.text}"
    return s

@pytest.fixture(scope="module")
def first_product_id(admin_session):
    r = admin_session.get(f"{BASE_URL}/api/products")
    assert r.status_code == 200
    products = r.json()
    assert len(products) > 0
    return products[0]["id"]

# --- Stock update tests ---

class TestStockUpdateAPI:
    """Tests for PATCH /api/admin/products/{id}/stock"""

    def test_update_stock_success(self, admin_session, first_product_id):
        """Valid stock update returns ok: true with new stock value"""
        r = admin_session.patch(f"{BASE_URL}/api/admin/products/{first_product_id}/stock", json={"stock": 25})
        assert r.status_code == 200
        data = r.json()
        assert data.get("ok") is True
        assert data.get("stock") == 25

    def test_update_stock_persists(self, admin_session, first_product_id):
        """After update, GET /api/products shows the new stock"""
        admin_session.patch(f"{BASE_URL}/api/admin/products/{first_product_id}/stock", json={"stock": 33})
        r = admin_session.get(f"{BASE_URL}/api/products")
        assert r.status_code == 200
        products = r.json()
        p = next((x for x in products if x["id"] == first_product_id), None)
        assert p is not None
        assert p["stock"] == 33

    def test_update_stock_zero(self, admin_session, first_product_id):
        """Stock of 0 is valid (out of stock)"""
        r = admin_session.patch(f"{BASE_URL}/api/admin/products/{first_product_id}/stock", json={"stock": 0})
        assert r.status_code == 200
        data = r.json()
        assert data.get("ok") is True
        assert data.get("stock") == 0

    def test_update_stock_negative_returns_400(self, admin_session, first_product_id):
        """Negative stock returns 400"""
        r = admin_session.patch(f"{BASE_URL}/api/admin/products/{first_product_id}/stock", json={"stock": -5})
        assert r.status_code == 400

    def test_update_stock_invalid_product_id(self, admin_session):
        """Non-existent product id returns 404"""
        r = admin_session.patch(f"{BASE_URL}/api/admin/products/000000000000000000000000/stock", json={"stock": 10})
        assert r.status_code == 404

    def test_update_stock_unauthenticated(self, first_product_id):
        """Unauthenticated request should fail with 401/403"""
        r = requests.patch(f"{BASE_URL}/api/admin/products/{first_product_id}/stock", json={"stock": 10})
        assert r.status_code in [401, 403]

    def test_update_stock_non_admin_denied(self, demo_session, first_product_id):
        """Regular user cannot update stock"""
        r = demo_session.patch(f"{BASE_URL}/api/admin/products/{first_product_id}/stock", json={"stock": 10})
        assert r.status_code in [401, 403]

    def test_restore_stock_after_tests(self, admin_session, first_product_id):
        """Restore stock to 24 after tests"""
        r = admin_session.patch(f"{BASE_URL}/api/admin/products/{first_product_id}/stock", json={"stock": 24})
        assert r.status_code == 200
