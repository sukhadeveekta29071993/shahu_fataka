"""
Backend tests for POST /api/admin/products/bulk-stock
Tests: valid CSV, unknown products, invalid stock, dedup, missing headers
"""
import pytest
import requests
import os
import io

BASE_URL = "https://gh-import-8--0rcdj5rs.preview.emergentagent.com"

@pytest.fixture(scope="module")
def admin_session():
    session = requests.Session()
    r = session.post(f"{BASE_URL}/api/auth/login", json={"email": "admin@crackerpos.in", "password": "admin123"})
    assert r.status_code == 200, f"Login failed: {r.text}"
    return session

@pytest.fixture(scope="module")
def product_name(admin_session):
    """Get first product name from the catalog for use in CSV tests"""
    r = admin_session.get(f"{BASE_URL}/api/products")
    assert r.status_code == 200
    products = r.json()
    assert len(products) >= 2, "Need at least 2 products for bulk stock tests"
    return products[0]["name"], products[1]["name"]

# Test: Valid CSV with 2 known products
def test_bulk_stock_valid_csv(admin_session, product_name):
    p1, p2 = product_name
    csv_content = f"name,stock\n{p1},50\n{p2},100\n"
    files = {"file": ("test.csv", io.BytesIO(csv_content.encode()), "text/csv")}
    r = admin_session.post(f"{BASE_URL}/api/admin/products/bulk-stock", files=files)
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
    data = r.json()
    assert "updated" in data
    assert "not_found" in data
    assert "errors" in data
    assert len(data["updated"]) == 2
    assert len(data["not_found"]) == 0
    assert len(data["errors"]) == 0
    # Verify updated rows have before/after
    for row in data["updated"]:
        assert "name" in row
        assert "old_stock" in row
        assert "new_stock" in row

# Test: Unknown product names go to not_found
def test_bulk_stock_unknown_product(admin_session):
    csv_content = "name,stock\nXXXNonExistentProduct123,10\n"
    files = {"file": ("test.csv", io.BytesIO(csv_content.encode()), "text/csv")}
    r = admin_session.post(f"{BASE_URL}/api/admin/products/bulk-stock", files=files)
    assert r.status_code == 200
    data = r.json()
    assert len(data["not_found"]) == 1
    assert data["not_found"][0]["name"] == "XXXNonExistentProduct123"
    assert len(data["updated"]) == 0

# Test: Invalid stock value (non-numeric) goes to errors
def test_bulk_stock_invalid_stock_nonnumeric(admin_session, product_name):
    p1, _ = product_name
    csv_content = f"name,stock\n{p1},abc\n"
    files = {"file": ("test.csv", io.BytesIO(csv_content.encode()), "text/csv")}
    r = admin_session.post(f"{BASE_URL}/api/admin/products/bulk-stock", files=files)
    assert r.status_code == 200
    data = r.json()
    assert len(data["errors"]) == 1
    assert data["errors"][0]["name"] == p1

# Test: Negative stock goes to errors
def test_bulk_stock_invalid_stock_negative(admin_session, product_name):
    p1, _ = product_name
    csv_content = f"name,stock\n{p1},-5\n"
    files = {"file": ("test.csv", io.BytesIO(csv_content.encode()), "text/csv")}
    r = admin_session.post(f"{BASE_URL}/api/admin/products/bulk-stock", files=files)
    assert r.status_code == 200
    data = r.json()
    assert len(data["errors"]) == 1

# Test: Deduplication — only first occurrence processed
def test_bulk_stock_dedup(admin_session, product_name):
    p1, _ = product_name
    csv_content = f"name,stock\n{p1},77\n{p1},99\n"
    files = {"file": ("test.csv", io.BytesIO(csv_content.encode()), "text/csv")}
    r = admin_session.post(f"{BASE_URL}/api/admin/products/bulk-stock", files=files)
    assert r.status_code == 200
    data = r.json()
    assert len(data["updated"]) == 1
    assert data["updated"][0]["new_stock"] == 77

# Test: CSV missing name/stock headers returns 400
def test_bulk_stock_missing_headers(admin_session):
    csv_content = "product_title,quantity\nItem1,10\n"
    files = {"file": ("test.csv", io.BytesIO(csv_content.encode()), "text/csv")}
    r = admin_session.post(f"{BASE_URL}/api/admin/products/bulk-stock", files=files)
    assert r.status_code == 400

# Test: No file returns error
def test_bulk_stock_no_file(admin_session):
    r = admin_session.post(f"{BASE_URL}/api/admin/products/bulk-stock")
    assert r.status_code == 422  # unprocessable entity
