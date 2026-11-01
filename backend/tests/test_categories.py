"""Tests for Categories API: GET /api/categories, POST/PATCH/DELETE /api/admin/categories"""
import pytest
import requests
import os

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

# Admin credentials — read from env so secrets stay out of version control
ADMIN_EMAIL = os.environ.get("TEST_ADMIN_EMAIL", "admin@crackerpos.in")
ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD", "admin123")


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"Admin login failed: {r.text}"
    return s


class TestGetCategories:
    """Public GET /api/categories"""

    def test_get_categories_returns_list(self):
        r = requests.get(f"{BASE_URL}/api/categories")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 6

    def test_seed_categories_present(self):
        r = requests.get(f"{BASE_URL}/api/categories")
        names = [c["name"] for c in r.json()]
        for expected in ["Anar", "Fulzadi", "Bomb & Sutli", "Fancy Phatake", "Ladi", "Rockets"]:
            assert expected in names, f"Missing seed category: {expected}"

    def test_categories_have_id_and_name(self):
        r = requests.get(f"{BASE_URL}/api/categories")
        for cat in r.json():
            assert "id" in cat
            assert "name" in cat


class TestCreateCategory:
    """POST /api/admin/categories"""

    def test_create_category(self, admin_session):
        r = admin_session.post(f"{BASE_URL}/api/admin/categories", json={"name": "TEST_NewCat"})
        assert r.status_code == 200
        data = r.json()
        assert data["name"] == "TEST_NewCat"
        assert "id" in data

    def test_create_duplicate_blocked(self, admin_session):
        # First create
        admin_session.post(f"{BASE_URL}/api/admin/categories", json={"name": "TEST_DupCat"})
        # Second attempt
        r = admin_session.post(f"{BASE_URL}/api/admin/categories", json={"name": "TEST_DupCat"})
        assert r.status_code == 400

    def test_create_appears_in_list(self, admin_session):
        admin_session.post(f"{BASE_URL}/api/admin/categories", json={"name": "TEST_ListCat"})
        r = requests.get(f"{BASE_URL}/api/categories")
        names = [c["name"] for c in r.json()]
        assert "TEST_ListCat" in names


class TestRenameCategory:
    """PATCH /api/admin/categories/{id}"""

    def test_rename_category(self, admin_session):
        # Create
        r = admin_session.post(f"{BASE_URL}/api/admin/categories", json={"name": "TEST_RenameMe"})
        cat_id = r.json()["id"]
        # Rename
        r2 = admin_session.patch(f"{BASE_URL}/api/admin/categories/{cat_id}", json={"name": "TEST_Renamed"})
        assert r2.status_code == 200
        assert r2.json()["name"] == "TEST_Renamed"
        # Verify in list
        r3 = requests.get(f"{BASE_URL}/api/categories")
        names = [c["name"] for c in r3.json()]
        assert "TEST_Renamed" in names
        assert "TEST_RenameMe" not in names


class TestDeleteCategory:
    """DELETE /api/admin/categories/{id}"""

    def test_delete_empty_category(self, admin_session):
        r = admin_session.post(f"{BASE_URL}/api/admin/categories", json={"name": "TEST_DeleteMe"})
        cat_id = r.json()["id"]
        r2 = admin_session.delete(f"{BASE_URL}/api/admin/categories/{cat_id}")
        assert r2.status_code == 200
        # Verify gone
        r3 = requests.get(f"{BASE_URL}/api/categories")
        names = [c["name"] for c in r3.json()]
        assert "TEST_DeleteMe" not in names

    def test_delete_in_use_blocked(self, admin_session):
        # Anar has 2 products (seed data)
        r = requests.get(f"{BASE_URL}/api/categories")
        anar = next((c for c in r.json() if c["name"] == "Anar"), None)
        assert anar is not None
        r2 = admin_session.delete(f"{BASE_URL}/api/admin/categories/{anar['id']}")
        assert r2.status_code == 400


@pytest.fixture(scope="module", autouse=True)
def cleanup(admin_session):
    yield
    # Cleanup test categories
    r = requests.get(f"{BASE_URL}/api/categories")
    for cat in r.json():
        if cat["name"].startswith("TEST_"):
            admin_session.delete(f"{BASE_URL}/api/admin/categories/{cat['id']}")
