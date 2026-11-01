"""Regression tests for CrackerPOS code-quality fixes iteration 7"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": "admin@crackerpos.in", "password": "admin123"})
    assert r.status_code == 200, f"Admin login failed: {r.text}"
    return s

@pytest.fixture(scope="module")
def customer_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": "demo@crackerpos.in", "password": "demo1234"})
    assert r.status_code == 200, f"Customer login failed: {r.text}"
    return s


class TestAuth:
    """Auth context regression — login, /me endpoint"""

    def test_admin_login(self):
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": "admin@crackerpos.in", "password": "admin123"})
        assert r.status_code == 200
        data = r.json()
        assert data["role"] == "admin"
        assert data["email"] == "admin@crackerpos.in"

    def test_customer_login(self):
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": "demo@crackerpos.in", "password": "demo1234"})
        assert r.status_code == 200
        data = r.json()
        assert data["role"] == "customer"

    def test_me_endpoint_admin(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200
        data = r.json()
        assert data["role"] == "admin"
        assert "name" in data

    def test_me_endpoint_unauthenticated(self):
        r = requests.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 401


class TestGetOrderFix:
    """server.py get_order ObjectId fix — invalid ID must 404, not 500"""

    def test_invalid_order_id_returns_404(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/orders/invalidid123")
        assert r.status_code == 404

    def test_nonexistent_order_id_returns_404(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/orders/000000000000000000000000")
        assert r.status_code == 404

    def test_valid_order_fetch(self, admin_session, customer_session):
        # Create an order first
        products_r = customer_session.get(f"{BASE_URL}/api/products")
        products = products_r.json()
        assert len(products) > 0
        product = products[0]
        order_r = customer_session.post(f"{BASE_URL}/api/orders", json={
            "items": [{"product_id": product["id"], "qty": 1}],
            "payment_mode": "cash"
        })
        assert order_r.status_code == 200
        order_id = order_r.json()["id"]
        # Customer can fetch
        fetch_r = customer_session.get(f"{BASE_URL}/api/orders/{order_id}")
        assert fetch_r.status_code == 200
        data = fetch_r.json()
        assert data["id"] == order_id
        assert "invoice_no" in data
        assert "items" in data
        assert len(data["items"]) > 0


class TestAdminDashboard:
    """Admin dashboard regression"""

    def test_admin_stats(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/admin/stats")
        assert r.status_code == 200
        data = r.json()
        assert "today_orders" in data
        assert "total_orders" in data
        assert "low_stock" in data

    def test_admin_orders(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/admin/orders")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_admin_products(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/products")
        assert r.status_code == 200
        data = r.json()
        assert len(data) > 0
        assert "id" in data[0]
        assert "name" in data[0]


class TestSalespersonRegression:
    """Salesperson feature regression after code-quality fixes"""

    def test_list_salespersons(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/admin/salespersons")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_add_and_delete_salesperson(self, admin_session):
        # Add
        r = admin_session.post(f"{BASE_URL}/api/admin/salespersons", json={"name": "TEST_RegSeller"})
        assert r.status_code == 200
        sp_id = r.json()["id"]
        # Verify in list
        list_r = admin_session.get(f"{BASE_URL}/api/admin/salespersons")
        names = [sp["name"] for sp in list_r.json()]
        assert "TEST_RegSeller" in names
        # Delete
        del_r = admin_session.delete(f"{BASE_URL}/api/admin/salespersons/{sp_id}")
        assert del_r.status_code == 200


class TestWholesale:
    """AdminWholesale console.error regression — endpoints must still work"""

    def test_list_wholesale_users(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/admin/wholesale")
        assert r.status_code == 200
        assert isinstance(r.json(), list)


class TestPOSOrderWithSalesperson:
    """POS order with salesperson — receipt should show salesperson_name"""

    def test_pos_order_creates_and_receipt_shows_salesperson(self, admin_session):
        # Get a salesperson
        sps = admin_session.get(f"{BASE_URL}/api/admin/salespersons").json()
        sp = next((s for s in sps if s["name"] in ("Ravi Kumar", "Test Seller")), None)
        if not sp:
            # create one
            cr = admin_session.post(f"{BASE_URL}/api/admin/salespersons", json={"name": "TEST_POSSeller"})
            sp = cr.json()

        products = admin_session.get(f"{BASE_URL}/api/products").json()
        product = products[0]

        r = admin_session.post(f"{BASE_URL}/api/admin/pos", json={
            "customer_name": "Test Customer",
            "customer_phone": "9876543210",
            "customer_type": "retail",
            "items": [{"product_id": product["id"], "qty": 1}],
            "payment_mode": "cash",
            "salesperson_id": sp["id"]
        })
        assert r.status_code == 200
        data = r.json()
        assert data["salesperson_name"] == sp["name"]
        assert data["is_pos"] is True
        assert "invoice_no" in data
