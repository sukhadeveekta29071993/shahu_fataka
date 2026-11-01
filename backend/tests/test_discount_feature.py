"""Tests for POS discount feature - percent and flat discount"""
import pytest
import requests
import os

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

@pytest.fixture(scope="module")
def auth_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": "admin@crackerpos.in", "password": "admin123"})
    assert r.status_code == 200, f"Admin login failed: {r.text}"
    return s

@pytest.fixture(scope="module")
def test_product(auth_session):
    r = auth_session.get(f"{BASE_URL}/api/products")
    products = r.json()
    for p in products:
        if p.get("retail_price", 0) > 0 and p.get("stock", 0) > 0:
            return p
    pytest.skip("No valid product with stock found")

def place_order(session, product_id, qty, discount_type, discount_value):
    payload = {
        "customer_name": "Test Customer",
        "customer_phone": "",
        "customer_type": "retail",
        "items": [{"product_id": product_id, "qty": qty}],
        "payment_mode": "cash",
        "salesperson_id": "",
        "discount_type": discount_type,
        "discount_value": discount_value,
    }
    return session.post(f"{BASE_URL}/api/admin/pos", json=payload)

class TestDiscountPercent:
    def test_percent_discount_status(self, auth_session, test_product):
        r = place_order(auth_session, test_product["id"], 1, "percent", 10)
        assert r.status_code == 200, f"Failed: {r.text}"

    def test_percent_discount_values(self, auth_session, test_product):
        price = test_product["retail_price"]
        r = place_order(auth_session, test_product["id"], 1, "percent", 10)
        assert r.status_code == 200
        order_id = r.json()["id"]
        detail = auth_session.get(f"{BASE_URL}/api/orders/{order_id}")
        assert detail.status_code == 200
        d = detail.json()
        expected_discount = round(price * 0.1, 2)
        expected_taxable = round(price - expected_discount, 2)
        expected_cgst = round(expected_taxable * 0.09, 2)
        assert abs(d["discount"] - expected_discount) < 0.05, f"Discount mismatch: {d['discount']} vs {expected_discount}"
        assert abs(d["taxable_value"] - expected_taxable) < 0.05, f"Taxable mismatch: {d['taxable_value']} vs {expected_taxable}"
        assert abs(d["cgst"] - expected_cgst) < 0.05, f"CGST mismatch: {d['cgst']} vs {expected_cgst}"
        print(f"PASS: price={price}, discount={d['discount']}, taxable={d['taxable_value']}, cgst={d['cgst']}")

class TestDiscountFlat:
    def test_flat_discount_status(self, auth_session, test_product):
        r = place_order(auth_session, test_product["id"], 1, "flat", 20)
        assert r.status_code == 200, f"Failed: {r.text}"

    def test_flat_discount_values(self, auth_session, test_product):
        price = test_product["retail_price"]
        r = place_order(auth_session, test_product["id"], 1, "flat", 20)
        assert r.status_code == 200
        order_id = r.json()["id"]
        detail = auth_session.get(f"{BASE_URL}/api/orders/{order_id}")
        d = detail.json()
        expected_discount = min(20, price)
        expected_taxable = round(price - expected_discount, 2)
        assert abs(d["discount"] - expected_discount) < 0.05, f"Flat discount mismatch: {d['discount']} vs {expected_discount}"
        assert abs(d["taxable_value"] - expected_taxable) < 0.05, f"Taxable mismatch: {d['taxable_value']} vs {expected_taxable}"
        print(f"PASS: price={price}, flat_discount={d['discount']}, taxable={d['taxable_value']}")

class TestDiscountNone:
    def test_no_discount(self, auth_session, test_product):
        r = place_order(auth_session, test_product["id"], 1, "none", 0)
        assert r.status_code == 200
        order_id = r.json()["id"]
        detail = auth_session.get(f"{BASE_URL}/api/orders/{order_id}")
        d = detail.json()
        assert d["discount"] == 0, f"Expected discount=0, got {d['discount']}"
        print(f"PASS: no discount, discount_field={d['discount']}")

class TestDiscountReceipt:
    def test_discount_in_receipt(self, auth_session, test_product):
        r = place_order(auth_session, test_product["id"], 1, "percent", 5)
        assert r.status_code == 200
        order_id = r.json()["id"]
        detail = auth_session.get(f"{BASE_URL}/api/orders/{order_id}")
        d = detail.json()
        assert "discount" in d, "discount field missing from order"
        assert d["discount"] > 0, f"Expected discount > 0, got {d['discount']}"
        print(f"PASS: 5% discount={d['discount']}, receipt has discount field")
