"""Backend tests for barcode features: product barcode field, barcode lookup, scanner mode settings"""
import pytest
import requests
import os

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

@pytest.fixture(scope="module")
def admin_token():
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={"email": "admin@crackerpos.in", "password": "admin123"})
    assert resp.status_code == 200, f"Admin login failed: {resp.text}"
    # Extract token from cookie or body
    data = resp.json()
    token = data.get("access_token") or data.get("token")
    cookies = resp.cookies
    return {"token": token, "cookies": cookies}

@pytest.fixture(scope="module")
def auth_session(admin_token):
    session = requests.Session()
    session.cookies.update(admin_token["cookies"])
    if admin_token["token"]:
        session.headers.update({"Authorization": f"Bearer {admin_token['token']}"})
    return session

# Test 1: GET /api/products returns barcode field for all products
class TestProductsAPI:
    def test_products_have_barcode_field(self, auth_session):
        resp = auth_session.get(f"{BASE_URL}/api/products")
        assert resp.status_code == 200
        products = resp.json()
        assert len(products) > 0, "No products returned"
        # Check all products have barcode field
        without_barcode = [p for p in products if "barcode" not in p]
        assert len(without_barcode) == 0, f"{len(without_barcode)} products missing barcode field"
        print(f"PASS: All {len(products)} products have barcode field")

    def test_products_have_non_empty_barcodes(self, auth_session):
        resp = auth_session.get(f"{BASE_URL}/api/products")
        assert resp.status_code == 200
        products = resp.json()
        empty_barcodes = [p["name"] for p in products if not p.get("barcode")]
        print(f"Products without barcode: {len(empty_barcodes)}")
        # At least 50 should have barcodes
        products_with_barcode = [p for p in products if p.get("barcode")]
        assert len(products_with_barcode) >= 50, f"Only {len(products_with_barcode)} products have barcodes (expected >= 50)"
        print(f"PASS: {len(products_with_barcode)} products have barcodes")

    def test_barcode_format(self, auth_session):
        resp = auth_session.get(f"{BASE_URL}/api/products")
        products = resp.json()
        barcoded = [p for p in products if p.get("barcode")]
        for p in barcoded[:5]:
            assert p["barcode"].startswith("890"), f"Product {p['name']} barcode {p['barcode']} doesn't start with 890"
            assert len(p["barcode"]) == 12, f"Product {p['name']} barcode length {len(p['barcode'])} != 12"
        print(f"PASS: Barcode format validated for first 5 products")


class TestBarcodeLookup:
    def test_lookup_valid_barcode(self, auth_session):
        # Get a product with barcode
        resp = auth_session.get(f"{BASE_URL}/api/products")
        products = resp.json()
        barcoded = [p for p in products if p.get("barcode")]
        assert len(barcoded) > 0, "No products with barcodes"
        
        test_product = barcoded[0]
        barcode = test_product["barcode"]
        
        # Look up by barcode
        lookup_resp = auth_session.get(f"{BASE_URL}/api/products/barcode/{barcode}")
        assert lookup_resp.status_code == 200, f"Barcode lookup failed: {lookup_resp.text}"
        
        data = lookup_resp.json()
        assert data["id"] == test_product["id"]
        assert data["name"] == test_product["name"]
        assert data["barcode"] == barcode
        print(f"PASS: Barcode lookup found '{data['name']}' for barcode {barcode}")

    def test_lookup_invalid_barcode_returns_404(self, auth_session):
        resp = auth_session.get(f"{BASE_URL}/api/products/barcode/999999999999")
        assert resp.status_code == 404, f"Expected 404 for invalid barcode, got {resp.status_code}"
        print("PASS: Invalid barcode returns 404")

    def test_lookup_returns_barcode_field(self, auth_session):
        resp = auth_session.get(f"{BASE_URL}/api/products")
        products = resp.json()
        barcoded = [p for p in products if p.get("barcode")]
        barcode = barcoded[0]["barcode"]
        
        lookup_resp = auth_session.get(f"{BASE_URL}/api/products/barcode/{barcode}")
        data = lookup_resp.json()
        assert "barcode" in data
        assert data["barcode"] == barcode
        print("PASS: Barcode lookup response includes barcode field")


class TestScannerModeSettings:
    def test_get_settings(self, auth_session):
        resp = auth_session.get(f"{BASE_URL}/api/admin/settings")
        assert resp.status_code == 200
        data = resp.json()
        assert "scanner_mode" in data, "scanner_mode not in settings response"
        print(f"PASS: Settings has scanner_mode field = {data['scanner_mode']}")

    def test_enable_scanner_mode(self, auth_session):
        resp = auth_session.patch(f"{BASE_URL}/api/admin/settings", json={"scanner_mode": True})
        assert resp.status_code == 200
        # Verify it was saved
        get_resp = auth_session.get(f"{BASE_URL}/api/admin/settings")
        data = get_resp.json()
        assert data["scanner_mode"] == True
        print("PASS: Scanner mode enabled and persisted")

    def test_disable_scanner_mode(self, auth_session):
        resp = auth_session.patch(f"{BASE_URL}/api/admin/settings", json={"scanner_mode": False})
        assert resp.status_code == 200
        # Verify it was saved
        get_resp = auth_session.get(f"{BASE_URL}/api/admin/settings")
        data = get_resp.json()
        assert data["scanner_mode"] == False
        print("PASS: Scanner mode disabled and persisted")
