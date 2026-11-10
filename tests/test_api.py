from unittest.mock import AsyncMock

from review_helper import store
from review_helper.demo import demo_review
from review_helper.models import ReviewProgress


def test_api_documents_and_demo(client):
    assert client.get("/health").json()["status"] == "ok"
    schema = client.get("/openapi.json").json()
    assert "/api/reviews" in schema["paths"]
    assert client.get("/docs").status_code == 200
    assert client.get("/redoc").status_code == 200
    assert client.get("/").status_code == 200
    review = client.get("/api/demo").json()
    assert len(review["sections"]) == 4
    assert client.get("/api/reviews/demo").json()["id"] == "demo"
    assert client.get("/api/reviews/missing").status_code == 404
    assert client.get("/api/reviews/demo/sections/missing").status_code == 404
    assert len(client.get("/api/reviews/demo/sections/collections").json()["files"]) == 7


def test_workspace_token_and_cross_origin_protection(client, monkeypatch):
    monkeypatch.setenv("REVIEW_HELPER_ACCESS_TOKEN", "secret")
    assert client.get("/api/demo").status_code == 401
    assert client.get("/api/demo", headers={"Authorization": "Bearer wrong"}).status_code == 401
    headers = {"Authorization": "Bearer secret"}
    assert client.get("/api/config", headers=headers).json()["auth_enabled"]
    assert client.get("/api/demo", headers=headers).status_code == 200
    assert (
        client.post(
            "/api/reviews", json={"url": "bad"}, headers={**headers, "Origin": "https://evil.test"}
        ).status_code
        == 403
    )
    assert client.post("/mcp/", json={}, headers={"Origin": "https://evil.test"}).status_code == 401


def test_import_validation_and_no_token_persistence(client, monkeypatch):
    assert client.post("/api/reviews", json={"url": "https://localhost/a"}).status_code == 400
    mock = AsyncMock(return_value=demo_review().model_copy(update={"id": "saved"}))
    monkeypatch.setattr("review_helper.providers.ProviderClient.load", mock)
    result = client.post(
        "/api/reviews", json={"url": "https://github.com/acme/app/pull/1", "token": "sensitive"}
    )
    assert result.status_code == 200
    assert "sensitive" not in result.text
    assert "sensitive" not in store.database_path().read_bytes().decode(errors="replace")
    assert client.get("/api/reviews/saved").status_code == 200


def test_progress_is_validated_and_persistent(client):
    endpoint = "/api/reviews/demo/progress"
    assert client.get(endpoint).json() == {"sections": []}
    assert client.put(endpoint, json={"sections": ["collections", "collections"]}).json() == {
        "sections": ["collections"]
    }
    assert client.get(endpoint).json()["sections"] == ["collections"]
    assert client.put(endpoint, json={"sections": ["fake"]}).status_code == 422
    assert ReviewProgress(sections=["a", "a"]).sections == ["a"]


def test_plan_update_rejects_stale_and_incomplete_and_resets_progress(client):
    review = demo_review()
    body = {
        "expected_head": "stale",
        "sections": [s.model_dump() for s in review.sections],
        "relationships": [],
    }
    assert client.put("/api/reviews/demo/plan", json=body).status_code == 409
    body["expected_head"] = review.head_sha
    assert client.put("/api/reviews/demo/progress", json={"sections": ["collections"]}).status_code == 200
    assert client.put("/api/reviews/demo/plan", json=body).json()["grouping"] == "model"
    assert client.get("/api/reviews/demo/progress").json()["sections"] == []
    body["sections"].pop()
    assert client.put("/api/reviews/demo/plan", json=body).status_code == 422


def test_progress_is_bound_to_snapshot_head():
    review = demo_review().model_copy(update={"id": "new"})
    store.save(review)
    store.progress("new", ["collections"])
    review.head_sha = "changed"
    store.save(review)
    assert store.progress("new") == []


def test_vercel_default_store(monkeypatch):
    monkeypatch.delenv("REVIEW_HELPER_DB_PATH")
    monkeypatch.setenv("VERCEL", "1")
    assert str(store.database_path()).replace("\\", "/") == "/tmp/review-helper.sqlite3"


def test_mcp_host_preview_page(client):
    response = client.get("/mcp-preview")
    assert response.status_code == 200
    assert "ui/initialize" in response.text and 'src="/"' in response.text
