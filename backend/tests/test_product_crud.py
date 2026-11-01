"""
Tests for Product CRUD: POST /api/admin/products, PATCH /api/admin/products/{id},
DELETE /api/admin/products/{id}, and Order Filters (data fetch).
Uses cookie-based auth (httpOnly cookie set on login).
"""
import pytest
import requests
import os

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
ADMIN_CREDS = {"email": "admin@crackerpos.in", "password": "admin123"}


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=ADMIN_CREDS)
    assert r.status_code == 200, f"Login failed: {r.text}"
    return s


class TestProductCRUD:
    """Full lifecycle: create → update → delete"""

    def test_full_product_lifecycle(self, session):
        # CREATE
        payload = {
            "name": "TEST_Chakri Gold",
            "category": "Anar",
            "pack_type": "Box",
            "pack_size": "10 pcs",
            "icon": "chakri",
            "retail_price": 250,
            "wholesale_price": 200,
            "hsn": "3604",
            "stock": 30,
        }
        r = session.post(f"{BASE_URL}/api/admin/products", json=payload)
        assert r.status_code in (200, 201), f"Create failed: {r.status_code}: {r.text}"
        data = r.json()
        assert data.get("name") == "TEST_Chakri Gold"
        assert data.get("retail_price") == 250
        assert data.get("stock") == 30
        assert "id" in data
        pid = data["id"]

        # Verify in list
        r2 = session.get(f"{BASE_URL}/api/products")
        assert r2.status_code == 200
        ids = [p["id"] for p in r2.json()]
        assert pid in ids, "Created product not in products list"

        # UPDATE retail price (full payload required)
        updated_payload = {**payload, "retail_price": 300, "stock": 30}
        r3 = session.patch(f"{BASE_URL}/api/admin/products/{pid}", json=updated_payload)
        assert r3.status_code == 200, f"PATCH failed: {r3.status_code}: {r3.text}"
        assert r3.json().get("retail_price") == 300

        # UPDATE name
        r4 = session.patch(f"{BASE_URL}/api/admin/products/{pid}",
                           json={**updated_payload, "name": "TEST_Chakri Gold Updated"})
        assert r4.status_code == 200
        assert r4.json().get("name") == "TEST_Chakri Gold Updated"

        # DELETE
        r5 = session.delete(f"{BASE_URL}/api/admin/products/{pid}")
        assert r5.status_code in (200, 204), f"DELETE failed: {r5.status_code}: {r5.text}"

        # Verify deleted
        r6 = session.get(f"{BASE_URL}/api/products")
        ids_after = [p["id"] for p in r6.json()]
        assert pid not in ids_after, "Deleted product still in list"

    def test_create_product_unauthenticated(self):
        r = requests.post(f"{BASE_URL}/api/admin/products",
                          json={"name": "X", "retail_price": 1, "wholesale_price": 1})
        assert r.status_code in (401, 403)

    def test_update_nonexistent_product(self, session):
        r = session.patch(f"{BASE_URL}/api/admin/products/000000000000000000000000",
                          json={"name": "X", "retail_price": 100, "wholesale_price": 80,
                                "category": "Anar", "pack_type": "", "pack_size": "",
                                "icon": "anar", "stock": 0, "hsn": "3604"})
        assert r.status_code in (400, 404)

    def test_delete_nonexistent_product(self, session):
        r = session.delete(f"{BASE_URL}/api/admin/products/000000000000000000000000")
        assert r.status_code == 404


class TestOrdersAPI:
    """Orders list for filter testing"""

    def test_orders_list_returns_200(self, session):
        r = session.get(f"{BASE_URL}/api/admin/orders?limit=100")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_orders_have_required_fields(self, session):
        r = session.get(f"{BASE_URL}/api/admin/orders?limit=100")
        orders = r.json()
        if orders:
            o = orders[0]
            for field in ("id", "status", "created_at", "is_pos"):
                assert field in o, f"Missing field: {field}"
