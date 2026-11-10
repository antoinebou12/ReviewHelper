import pytest
from fastapi.testclient import TestClient

from review_helper.app import app


@pytest.fixture(autouse=True)
def isolated_store(tmp_path, monkeypatch):
    monkeypatch.setenv("REVIEW_HELPER_DB_PATH", str(tmp_path / "reviews.sqlite3"))
    for name in (
        "REVIEW_HELPER_ACCESS_TOKEN",
        "GITHUB_TOKEN",
        "GITLAB_TOKEN",
        "AZURE_DEVOPS_TOKEN",
        "BITBUCKET_TOKEN",
        "BITBUCKET_EMAIL",
    ):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture(scope="session")
def client():
    with TestClient(app, base_url="http://127.0.0.1:8000") as client:
        yield client
