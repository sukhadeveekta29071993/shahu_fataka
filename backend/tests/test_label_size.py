# Label Size Setting: GET/PATCH /api/admin/settings label_width_mm/label_height_mm
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN = {"email": "tmshivas@gmail.com", "password": "shimu@4321"}


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=ADMIN)
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}")
    tok = r.json().get("access_token") or r.json().get("token")
    if tok:
        s.headers["Authorization"] = f"Bearer {tok}"
    yield s
    s.patch(f"{BASE_URL}/api/admin/settings", json={"label_width_mm": 50, "label_height_mm": 25})


def test_get_has_label_fields(client):
    r = client.get(f"{BASE_URL}/api/admin/settings")
    assert r.status_code == 200
    d = r.json()
    assert "label_width_mm" in d and "label_height_mm" in d
    assert isinstance(d["label_width_mm"], (int, float))


def test_unauth_get_rejected():
    r = requests.get(f"{BASE_URL}/api/admin/settings")
    assert r.status_code in (401, 403)


def test_patch_valid_persists(client):
    r = client.patch(f"{BASE_URL}/api/admin/settings", json={"label_width_mm": 62, "label_height_mm": 35})
    assert r.status_code == 200
    d = client.get(f"{BASE_URL}/api/admin/settings").json()
    assert d["label_width_mm"] == 62 and d["label_height_mm"] == 35


def test_patch_boundaries(client):
    for w, h in ((20, 150), (150, 20), (40.5, 30.25)):
        r = client.patch(f"{BASE_URL}/api/admin/settings", json={"label_width_mm": w, "label_height_mm": h})
        assert r.status_code == 200, (w, h, r.text)
    d = client.get(f"{BASE_URL}/api/admin/settings").json()
    assert d["label_width_mm"] == 40.5
    assert d["label_height_mm"] in (30.2, 30.3)


@pytest.mark.parametrize("field", ["label_width_mm", "label_height_mm"])
@pytest.mark.parametrize("bad", [10, 200, "abc", True, None, "50", 19.9, 150.1])
def test_patch_invalid(client, field, bad):
    r = client.patch(f"{BASE_URL}/api/admin/settings", json={field: bad})
    assert r.status_code == 400, (field, bad, r.text)
    assert "must be a number between 20 and 150 mm" in r.json()["detail"]


def test_invalid_does_not_change_other_fields(client):
    client.patch(f"{BASE_URL}/api/admin/settings", json={"label_width_mm": 62, "label_height_mm": 35})
    r = client.patch(f"{BASE_URL}/api/admin/settings", json={"label_width_mm": 62, "label_height_mm": 999})
    assert r.status_code == 400
    d = client.get(f"{BASE_URL}/api/admin/settings").json()
    assert d["label_height_mm"] == 35


def test_reset_default(client):
    r = client.patch(f"{BASE_URL}/api/admin/settings", json={"label_width_mm": 50, "label_height_mm": 25})
    assert r.status_code == 200
    d = client.get(f"{BASE_URL}/api/admin/settings").json()
    assert d["label_width_mm"] == 50 and d["label_height_mm"] == 25


def test_openapi():
    assert requests.get(f"{BASE_URL}/api/openapi.json").status_code == 200
