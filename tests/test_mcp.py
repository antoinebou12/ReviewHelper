import json
from unittest.mock import AsyncMock

import pytest

from review_helper.demo import demo_review
from review_helper.mcp_server import (
    APP_URI,
    get_workspace,
    guide,
    manifest,
    mcp,
    open_review,
    propose_review_plan,
    review_feature,
    review_progress,
    workspace_html,
)
from review_helper.models import ReviewPlan


async def test_tools_resources_and_prompt():
    tools = await mcp.list_tools()
    opener = next(t for t in tools if t.name == "open_review")
    assert opener.meta["ui"]["resourceUri"] == APP_URI
    assert len([t for t in tools if t.meta and t.meta.get("ui", {}).get("visibility") == ["app"]]) == 3
    resources = await mcp.list_resources()
    assert any(str(r.uri) == APP_URI and r.mimeType == "text/html;profile=mcp-app" for r in resources)
    result = await open_review()
    assert len(result.content[0].text) < 2000
    assert "patch" not in result.content[0].text
    # The open call stays small; the viewer fetches the full snapshot through an app-only tool.
    assert result.meta["review_id"] == "demo" and "review" not in result.meta
    workspace = get_workspace("demo")
    assert workspace.structuredContent["id"] == "demo"
    assert workspace.meta["review"]["files"][0]["patch"]
    assert "read_section" in review_feature("demo", "collections")
    assert "untrusted" in guide()
    assert "patch" not in json.loads(manifest("demo"))["files"][0]
    assert "text/html" not in workspace_html()[:15]
    assert "<html" in workspace_html()


async def test_mcp_import_and_plan(monkeypatch):
    monkeypatch.setattr("review_helper.providers.ProviderClient.load", AsyncMock(return_value=demo_review()))
    assert (await open_review("https://github.com/a/b/pull/1")).structuredContent["id"] == "demo"
    review = demo_review()
    plan = ReviewPlan(sections=review.sections)
    with pytest.raises(ValueError, match="Snapshot"):
        propose_review_plan("demo", "wrong", plan)
    assert propose_review_plan("demo", review.head_sha, plan).structuredContent["grouping"] == "model"
    assert review_progress("demo", ["collections"]) == {"sections": ["collections"]}


def test_real_streamable_http_protocol(client):
    headers = {"Accept": "application/json, text/event-stream"}

    def rpc(method, params=None):
        response = client.post(
            "/mcp/",
            headers=headers,
            json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert "error" not in body, body
        return body["result"]

    initialized = rpc(
        "initialize",
        {"protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "test", "version": "1"}},
    )
    assert initialized["serverInfo"]["name"] == "Review Helper"
    headers["MCP-Protocol-Version"] = initialized["protocolVersion"]
    listed = rpc("tools/list")
    assert any(t["name"] == "open_review" for t in listed["tools"])
    result = rpc("tools/call", {"name": "open_review", "arguments": {"url": "demo"}})
    assert result["_meta"]["review_id"] == "demo"
    resource = rpc("resources/read", {"uri": APP_URI})
    assert resource["contents"][0]["mimeType"] == "text/html;profile=mcp-app"
    assert "Review Helper" in resource["contents"][0]["text"]
    prompt = rpc(
        "prompts/get",
        {"name": "review_feature", "arguments": {"review_id": "demo", "section_id": "collections"}},
    )
    assert "read_section" in prompt["messages"][0]["content"]["text"]


def test_cli_transports(monkeypatch):
    from review_helper.cli import main

    called = []
    monkeypatch.setattr("sys.argv", ["review-helper", "--port", "8100"])
    monkeypatch.setattr("uvicorn.run", lambda *a, **kw: called.append(kw))
    main()
    assert called[0]["port"] == 8100
    monkeypatch.setattr("sys.argv", ["review-helper", "--stdio"])
    monkeypatch.setattr(mcp, "run", lambda **kw: called.append(kw))
    main()
    assert called[-1]["transport"] == "stdio"
