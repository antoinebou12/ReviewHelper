"""Entra device login, Jira linking, and the local MCP linter."""

import json
import time

import httpx
import pytest

from review_helper import jira
from review_helper.demo import demo_review
from review_helper.entra import EntraLogin, LoginError
from review_helper.lint import inspect_definitions, run_lint

CLIENT_ID = "11111111-2222-3333-4444-555555555555"


@pytest.fixture
def azure_env(monkeypatch):
    monkeypatch.setenv("AZURE_CLIENT_ID", CLIENT_ID)
    monkeypatch.setenv("AZURE_TENANT_ID", "contoso.onmicrosoft.com")
    monkeypatch.delenv("VERCEL", raising=False)


def entra_transport(token_responses):
    calls = []

    def handler(request: httpx.Request):
        calls.append(request.url.path)
        if request.url.path.endswith("/devicecode"):
            return httpx.Response(
                200,
                json={"device_code": "dc", "user_code": "ABCD-EFGH", "expires_in": 900, "interval": 0},
            )
        return token_responses.pop(0)

    return httpx.MockTransport(handler), calls


def test_entra_requires_configuration(monkeypatch):
    monkeypatch.delenv("AZURE_CLIENT_ID", raising=False)
    with pytest.raises(LoginError, match="AZURE_CLIENT_ID"):
        EntraLogin().settings()
    monkeypatch.setenv("AZURE_CLIENT_ID", CLIENT_ID)
    monkeypatch.setenv("AZURE_TENANT_ID", "bad/tenant")
    with pytest.raises(LoginError):
        EntraLogin().settings()


def test_entra_refuses_serverless(azure_env, monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    with pytest.raises(LoginError, match="persistent"):
        EntraLogin().settings()


async def test_entra_device_flow_never_returns_token(azure_env):
    transport, calls = entra_transport(
        [
            httpx.Response(400, json={"error": "authorization_pending"}),
            httpx.Response(400, json={"error": "slow_down"}),
            httpx.Response(200, json={"access_token": "secret-token", "expires_in": 3600}),
        ]
    )
    login = EntraLogin()
    started = await login.start(transport)
    assert started["user_code"] == "ABCD-EFGH"
    assert started["verification_uri"] == "https://microsoft.com/devicelogin"
    assert '"dc"' not in json.dumps(started)
    assert (await login.poll(started["login_id"], transport))["status"] == "pending"
    slowed = await login.poll(started["login_id"], transport)
    assert slowed == {"status": "pending", "interval": 5}
    # Polling before the interval elapses does not hit Microsoft.
    assert (await login.poll(started["login_id"], transport))["status"] == "pending"
    login.pending[started["login_id"]]["next_poll"] = 0
    done = await login.poll(started["login_id"], transport)
    assert done == {"status": "authenticated"}
    assert "secret-token" not in json.dumps(done) + json.dumps(login.status())
    assert login.token() == "secret-token" and login.status()["signed_in"]
    assert calls[0].startswith("/contoso.onmicrosoft.com/")
    assert login.logout() == {"signed_in": False} and login.token() is None


async def test_entra_denied_expired_and_limits(azure_env):
    transport, _ = entra_transport([httpx.Response(400, json={"error": "access_denied"})])
    login = EntraLogin()
    started = await login.start(transport)
    assert (await login.poll(started["login_id"], transport))["status"] == "failed"
    assert (await login.poll("unknown"))["status"] == "expired"
    for _ in range(5):
        await login.start(transport)
    with pytest.raises(LoginError, match="Too many"):
        await login.start(transport)
    login.access_token, login.expires_at = "old", time.time() - 1
    assert login.token() is None
    failing = httpx.MockTransport(lambda r: httpx.Response(400, json={}))
    with pytest.raises(LoginError, match="could not start"):
        await EntraLogin().start(failing)


def test_azure_api_routes(client, monkeypatch):
    monkeypatch.delenv("AZURE_CLIENT_ID", raising=False)
    assert client.get("/api/config").json()["azure"]["configured"] is False
    response = client.post("/api/auth/azure/start")
    assert response.status_code == 400 and "AZURE_CLIENT_ID" in response.json()["detail"]
    assert client.post("/api/auth/azure/poll/nope").json()["status"] == "expired"
    assert client.post("/api/auth/azure/logout").json() == {"signed_in": False}


async def test_azure_mcp_tool(monkeypatch):
    from review_helper.mcp_server import provider_connection

    monkeypatch.delenv("AZURE_CLIENT_ID", raising=False)
    assert (await provider_connection("azure", "status"))["configured"] is False
    assert (await provider_connection("azure", "logout")) == {"signed_in": False}
    assert (await provider_connection("azure", "poll", "missing"))["status"] == "expired"
    with pytest.raises(ValueError, match="login ID"):
        await provider_connection("azure", "poll")
    with pytest.raises(LoginError):
        await provider_connection("azure", "start")


def review_with_links():
    review = demo_review()
    review.description = (
        "Fixes https://acme.atlassian.net/browse/APP-7 and https://other.atlassian.net/browse/OPS-1."
    )
    review.comments = []
    return review


def test_jira_discovery_and_origin(monkeypatch):
    assert [i.key for i in jira.discover(review_with_links())] == ["APP-7", "OPS-1"]
    for bad in ("http://acme.atlassian.net", "https://evil.example.com", "https://acme.atlassian.net/x"):
        monkeypatch.setenv("JIRA_BASE_URL", bad)
        assert jira.jira_origin() is None
    monkeypatch.setenv("JIRA_BASE_URL", "https://acme.atlassian.net/")
    assert jira.jira_origin() == "https://acme.atlassian.net"


async def test_jira_loads_only_configured_site(monkeypatch):
    monkeypatch.setenv("JIRA_BASE_URL", "https://acme.atlassian.net")
    monkeypatch.setenv("JIRA_EMAIL", "me@example.com")
    monkeypatch.setenv("JIRA_API_TOKEN", "t")
    hosts = []

    def handler(request: httpx.Request):
        hosts.append(request.url.host)
        assert request.headers["authorization"].startswith("Basic ")
        return httpx.Response(
            200,
            json={
                "fields": {
                    "summary": "Saved collections",
                    "status": {"name": "In Review"},
                    "issuetype": {"name": "Story"},
                    "assignee": None,
                    "priority": {"name": "High"},
                }
            },
        )

    loaded, outside = await jira.load_issues(review_with_links(), httpx.MockTransport(handler))
    assert hosts == ["acme.atlassian.net"]
    assert loaded.loaded and loaded.status == "In Review" and loaded.assignee == "Unassigned"
    assert not outside.loaded and "outside" in outside.note


async def test_jira_errors_are_reported(monkeypatch):
    monkeypatch.setenv("JIRA_BASE_URL", "https://acme.atlassian.net")
    review = review_with_links()
    denied = await jira.load_issues(review, httpx.MockTransport(lambda r: httpx.Response(403)))
    assert "permissions" in denied[0].note
    broken = await jira.load_issues(review, httpx.MockTransport(lambda r: httpx.Response(200, text="nope")))
    assert "Could not load" in broken[0].note
    huge = await jira.load_issues(
        review, httpx.MockTransport(lambda r: httpx.Response(200, content=b"x" * 1_100_000))
    )
    assert "1 MB" in huge[0].note
    monkeypatch.delenv("JIRA_BASE_URL")
    assert not (await jira.load_issues(review))[0].loaded


async def test_local_lint_passes():
    report = await run_lint()
    failed = [c for c in report["checks"] if c["status"] == "fail"]
    assert report["passed"], failed
    assert report["hosted_manufact_checklist"] == "not run"
    assert report["estimated_model_tokens"] <= 4500


async def test_publish_lint_requires_domain(monkeypatch):
    monkeypatch.delenv("MCP_APP_DOMAIN", raising=False)
    report = await run_lint(publish=True)
    domain = next(c for c in report["checks"] if c["checkId"] == "view-domain-present")
    assert domain["status"] == "fail" and not report["passed"]


def test_lint_flags_bad_definitions():
    tool = {
        "name": "bad name!",
        "description": "x",
        "inputSchema": {"type": "object", "properties": {"a": {}}, "required": ["b"]},
        "_meta": {"ui": {"visibility": ["app", "app"], "resourceUri": "ui://missing"}},
    }
    resource = {"uri": "ui://x", "mimeType": "text/html", "_meta": {"ui": {}}}
    prompt = {"name": "p", "arguments": [{"name": "a"}]}
    report = inspect_definitions(
        [tool, tool], [resource], [prompt], '<html><script src="https://cdn.example/x.js"></script>'
    )
    failed = {c["checkId"] for c in report["checks"] if c["status"] == "fail"}
    assert {
        "tool-names-unique",
        "tool-title-present",
        "tool-description-present",
        "tool-name-format",
        "tool-hints-present",
        "tool-input-schema-valid",
        "prop-description",
        "tool-visibility-valid",
        "tool-resource-uri-readable",
        "tool-invocation-metadata-present",
        "resource-description-present",
        "resource-content-valid",
        "view-csp-present",
        "view-self-contained-assets",
        "prompt-description-present",
        "prompt-arg-description",
    } <= failed


def test_lint_cli(monkeypatch, tmp_path, capsys):
    from review_helper.lint import main

    out = tmp_path / "lint.json"
    monkeypatch.setattr("sys.argv", ["review-helper-lint", "--json", str(out)])
    with pytest.raises(SystemExit) as exit_info:
        main()
    assert exit_info.value.code == 0
    assert json.loads(out.read_text())["passed"]
    assert "PASS" in capsys.readouterr().out


async def test_github_device_flow(monkeypatch):
    from review_helper.entra import GitHubLogin
    from review_helper.providers import ProviderClient, parse_url

    monkeypatch.setenv("GITHUB_CLIENT_ID", "Iv23liABCDEF123456")
    monkeypatch.setenv("GITHUB_OAUTH_SCOPE", "repo")
    monkeypatch.delenv("VERCEL", raising=False)
    sent = []

    def handler(request: httpx.Request):
        sent.append((request.url.host, request.url.path, request.content.decode()))
        assert request.headers["accept"] == "application/json"
        if request.url.path == "/login/device/code":
            return httpx.Response(
                200, json={"device_code": "dc", "user_code": "WXYZ-1234", "expires_in": 900, "interval": 0}
            )
        # GitHub answers 200 even for pending/denied states.
        return httpx.Response(200, json={"access_token": "gho_secret", "token_type": "bearer"})

    login = GitHubLogin()
    transport = httpx.MockTransport(handler)
    started = await login.start(transport)
    assert started["verification_uri"] == "https://github.com/login/device"
    assert "scope=repo" in sent[0][2]
    assert await login.poll(started["login_id"], transport) == {"status": "authenticated"}
    assert sent[-1][:2] == ("github.com", "/login/oauth/access_token")
    assert login.expires_at > time.time() + 7 * 3600  # OAuth App tokens have no expires_in

    monkeypatch.setattr("review_helper.providers.github_login", login)
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    client = ProviderClient(parse_url("https://github.com/a/b/pull/1"))
    assert client.http.headers["authorization"] == "Bearer gho_secret"
    monkeypatch.setenv("GITHUB_TOKEN", "server-token")
    client = ProviderClient(parse_url("https://github.com/a/b/pull/1"))
    assert client.http.headers["authorization"] == "Bearer server-token"


def test_github_login_validation_and_routes(client, monkeypatch):
    from review_helper.entra import GitHubLogin

    monkeypatch.delenv("GITHUB_CLIENT_ID", raising=False)
    with pytest.raises(LoginError, match="GITHUB_CLIENT_ID"):
        GitHubLogin().settings()
    monkeypatch.setenv("GITHUB_CLIENT_ID", "Iv23liABCDEF123456")
    monkeypatch.setenv("GITHUB_OAUTH_SCOPE", "repo; drop")
    with pytest.raises(LoginError, match="SCOPE"):
        GitHubLogin().settings()
    monkeypatch.delenv("GITHUB_CLIENT_ID")
    assert client.get("/api/config").json()["github_oauth"]["configured"] is False
    response = client.post("/api/auth/github/start")
    assert response.status_code == 400 and "GITHUB_CLIENT_ID" in response.json()["detail"]
    assert client.post("/api/auth/github/logout").json() == {"signed_in": False}
    assert client.post("/api/auth/gitlab/start").status_code == 404
