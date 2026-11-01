"""Backend tests for POST /api/admin/products/bulk-barcode endpoint"""
import pytest
import requests
import os
import io

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": "admin@crackerpos.in", "password": "admin123"})
    assert r.status_code == 200, f"Login failed: {r.text}"
    return s

def post_csv(session, csv_content):
    return session.post(
        f"{BASE_URL}/api/admin/products/bulk-barcode",
        files={"file": ("test.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv")},
    )

class TestBulkBarcodeEndpoint:
    """Tests for the bulk barcode assign endpoint"""

    def test_valid_product_updates(self, admin_session):
        # Use '10 cm Fulzadi' which has barcode '890837004979'
        # Assign a fresh barcode to it
        csv = "name,barcode\n10 cm Fulzadi,5555555555551\nFakeProduct999,5555555555552\n"
        r = post_csv(admin_session, csv)
        assert r.status_code == 200, f"Expected 200 got {r.status_code}: {r.text}"
        data = r.json()
        assert "updated" in data
        assert "skipped" in data
        # At least 1 updated
        updated_names = [u["name"] for u in data["updated"]]
        assert "10 cm Fulzadi" in updated_names, f"Expected '10 cm Fulzadi' in updated: {data}"
        # FakeProduct999 skipped
        skipped_names = [s["name"] for s in data["skipped"]]
        assert "FakeProduct999" in skipped_names
        skip_item = next(s for s in data["skipped"] if s["name"] == "FakeProduct999")
        assert "not found" in skip_item["reason"].lower()

    def test_duplicate_barcode_skipped(self, admin_session):
        # Try to assign barcode '1111111111111' (belongs to '10 K (A)') to '10 K STD'
        csv = "name,barcode\n10 K STD,1111111111111\n"
        r = post_csv(admin_session, csv)
        assert r.status_code == 200
        data = r.json()
        assert len(data["skipped"]) >= 1
        skip = data["skipped"][0]
        assert "already used by" in skip["reason"].lower() or "already used" in skip["reason"].lower()

    def test_missing_name_column_returns_400(self, admin_session):
        # CSV missing 'name' column
        csv = "product_title,barcode\nSomeThing,1234567890123\n"
        r = post_csv(admin_session, csv)
        assert r.status_code == 400, f"Expected 400 got {r.status_code}: {r.text}"
        data = r.json()
        assert "detail" in data
        assert "name" in data["detail"].lower() or "barcode" in data["detail"].lower()

    def test_no_barcode_column_returns_400(self, admin_session):
        # CSV missing 'barcode' column
        csv = "name,sku\nSomeProduct,ABC123\n"
        r = post_csv(admin_session, csv)
        assert r.status_code == 400

    def test_unauthenticated_returns_401(self):
        s = requests.Session()
        csv = "name,barcode\n10 K (A),9999999999999\n"
        r = post_csv(s, csv)
        assert r.status_code == 401

    def test_empty_barcode_row_skipped(self, admin_session):
        csv = "name,barcode\n10 K (A),\n"
        r = post_csv(admin_session, csv)
        assert r.status_code == 200
        data = r.json()
        skipped_names = [s["name"] for s in data["skipped"]]
        assert "10 K (A)" in skipped_names

    def test_restore_original_barcode(self, admin_session):
        """Restore '10 cm Fulzadi' back to its original barcode after test_valid_product_updates"""
        csv = "name,barcode\n10 cm Fulzadi,890837004979\n"
        r = post_csv(admin_session, csv)
        assert r.status_code == 200
        data = r.json()
        updated_names = [u["name"] for u in data["updated"]]
        assert "10 cm Fulzadi" in updated_names
