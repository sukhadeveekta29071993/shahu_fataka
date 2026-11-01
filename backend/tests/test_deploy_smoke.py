# Deployment smoke tests: openapi, products, login for all roles, order creation, admin stats RBAC
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")

CREDS = {
    "admin1": ("tmshivas@gmail.com", "shimu@4321", "admin"),
    "admin2": ("tmrudmo@gmail.com", "Rudra@454545", "admin"),
    "retail": ("demo@crackerpos.in", "demo1234", "customer"),
    "wholesale": ("wholesale@crackerpos.in", "demo1234", "customer"),
    "sales": ("sales@crackerpos.in", "sales1234", "salesperson"),
}

_sessions = {}


def login(key):
    if key in _sessions:
        return _sessions[key]
    email, pw, _ = CREDS[key]
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, f"{key} login failed: {r.status_code} {r.text}"
    _sessions[key] = s
    return s


# OpenAPI / docs
def test_openapi_json():
    r = requests.get(f"{BASE_URL}/api/openapi.json")
    assert r.status_code == 200
    assert "json" in r.headers.get("content-type", "")
    d = r.json()
    assert "openapi" in d and "/api/products" in d["paths"]


def test_docs():
    r = requests.get(f"{BASE_URL}/api/docs")
    assert r.status_code == 200
    assert "swagger" in r.text.lower()


# Products
def test_products():
    r = requests.get(f"{BASE_URL}/api/products")
    assert r.status_code == 200
    d = r.json()
    assert isinstance(d, list) and len(d) > 0
    assert "id" in d[0] and "stock" in d[0] and "_id" not in d[0]


# Auth for each role
@pytest.mark.parametrize("key", list(CREDS.keys()))
def test_login_and_me(key):
    s = login(key)
    r = s.get(f"{BASE_URL}/api/auth/me")
    assert r.status_code == 200, r.text
    me = r.json()
    assert me["email"] == CREDS[key][0]
    assert me["role"] == CREDS[key][2]


def test_login_wrong_password():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": "nonexist_TEST@x.in", "password": "bad"})
    assert r.status_code in (400, 401)


# Orders
def test_retail_order_decrements_stock():
    s = login("retail")
    prods = requests.get(f"{BASE_URL}/api/products").json()
    p = next((x for x in prods if x.get("stock", 0) >= 5), None)
    assert p, "no product with stock"
    before = p["stock"]
    r = s.post(f"{BASE_URL}/api/orders", json={"items": [{"product_id": p["id"], "qty": 1}], "payment_mode": "cash"})
    assert r.status_code == 200, r.text
    o = r.json()
    assert o["id"] and o["invoice_no"]
    after = next(x for x in requests.get(f"{BASE_URL}/api/products").json() if x["id"] == p["id"])["stock"]
    assert after == before - 1
    g = s.get(f"{BASE_URL}/api/orders/{o['id']}")
    assert g.status_code == 200 and g.json()["id"] == o["id"]


# Admin stats RBAC
def test_admin_stats_admin():
    r = login("admin1").get(f"{BASE_URL}/api/admin/stats")
    assert r.status_code == 200 and isinstance(r.json(), dict)


@pytest.mark.parametrize("key", ["retail", "sales"])
def test_admin_stats_non_admin(key):
    r = login(key).get(f"{BASE_URL}/api/admin/stats")
    assert r.status_code in (401, 403)


def test_admin_stats_anon():
    r = requests.get(f"{BASE_URL}/api/admin/stats")
    assert r.status_code in (401, 403)
