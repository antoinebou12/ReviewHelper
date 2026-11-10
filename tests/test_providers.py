import httpx
import pytest

from review_helper.providers import (
    ProviderClient,
    ProviderError,
    count_lines,
    normalize_status,
    parse_url,
    split_patch,
)


@pytest.mark.parametrize(
    ("url", "provider", "repo"),
    [
        ("https://github.com/owner/repo/pull/42/files", "github", "owner/repo"),
        ("https://gitlab.com/org/sub/repo/-/merge_requests/8", "gitlab", "org/sub/repo"),
        (
            "https://dev.azure.com/org/my%20project/_git/repo/pullrequest/3",
            "azure",
            "org/my project/_git/repo",
        ),
        ("https://bitbucket.org/team/repo/pull-requests/7", "bitbucket", "team/repo"),
    ],
)
def test_url_parsing(url, provider, repo):
    location = parse_url(url)
    assert location.provider == provider
    assert location.repository == repo
    assert location.number > 0


@pytest.mark.parametrize(
    "url",
    [
        "http://github.com/a/b/pull/1",
        "https://localhost/a/b/pull/1",
        "https://github.com.evil.test/a/b/pull/1",
        "https://token@github.com/a/b/pull/1",
        "https://github.com:8080/a/b/pull/1",
        "https://github.com/a/b",
        "https://github.com/a/b/pull/0",
        "https://gitlab.com/../a/-/merge_requests/1",
        "https://gitlab.com/a%252Fb/-/merge_requests/1",
        "https://gitlab.com/a\\b/-/merge_requests/1",
    ],
)
def test_rejects_non_provider_fetch_targets(url):
    with pytest.raises(ProviderError):
        parse_url(url)


def client_for(provider="github", handler=None, token=None):
    urls = {
        "github": "https://github.com/a/b/pull/1",
        "gitlab": "https://gitlab.com/a/b/-/merge_requests/1",
        "azure": "https://dev.azure.com/a/b/_git/c/pullrequest/1",
        "bitbucket": "https://bitbucket.org/a/b/pull-requests/1",
    }
    return ProviderClient(
        parse_url(urls[provider]),
        token,
        transport=httpx.MockTransport(handler or (lambda r: httpx.Response(200, json=[]))),
    )


async def test_github_load_handles_deletions_binary_renames_comments_and_limits():
    pr = {
        "title": "Collections",
        "user": {"login": "alex"},
        "head": {"sha": "head", "ref": "feature"},
        "base": {"sha": "base", "ref": "main"},
        "changed_files": 8,
    }
    files = [
        {
            "filename": "web/collections.ts",
            "status": "renamed",
            "previous_filename": "web/old.ts",
            "additions": 1,
            "deletions": 1,
            "patch": "@@ -1 +1 @@\n-old\n+new",
        },
        {"filename": "api/collections.py", "status": "removed", "additions": 0, "deletions": 2},
        {"filename": "logo.png", "status": "modified", "additions": 0, "deletions": 0},
    ]

    def handler(request):
        path = request.url.path
        assert request.headers["Authorization"] == "Bearer test-token"
        if path.endswith("/pulls/1"):
            return httpx.Response(200, json=pr)
        if path.endswith("/files"):
            return httpx.Response(200, json=files)
        if path.endswith("/git/trees/head"):
            return httpx.Response(
                200,
                json={
                    "truncated": True,
                    "tree": [{"path": "web/collections.ts", "type": "blob"}, {"path": "web", "type": "tree"}],
                },
            )
        return httpx.Response(
            200,
            json=[
                {
                    "id": path,
                    "user": {"login": "maya"},
                    "body": "check",
                    "path": "web/old.ts",
                    "line": None,
                    "original_line": 2,
                }
            ],
        )

    review = await client_for(handler=handler, token="test-token").load()
    assert review.files[0].status == "renamed"
    assert review.files[1].status == "deleted"
    assert review.files[2].patch_note
    assert len(review.comments) == 2
    assert review.comments[0].line == 2
    assert len(review.warnings) == 2
    assert review.grouping == "heuristic"


async def test_gitlab_import_discussion_and_patch_states():
    def handler(request):
        path = request.url.path
        if path.endswith("/merge_requests/1"):
            data = {
                "title": "test",
                "author": {"username": "sam"},
                "sha": "head",
                "target_branch": "main",
                "source_branch": "feature",
                "diff_refs": {"base_sha": "base"},
            }
        elif path.endswith("/diffs"):
            data = [
                {"new_path": "a.py", "old_path": "a.py", "new_file": True, "diff": "@@ -0,0 +1 @@\n+x"},
                {"new_path": "b.py", "old_path": "old.py", "renamed_file": True, "diff": "-a\n+b"},
                {"new_path": "c.py", "deleted_file": True, "diff": "-x"},
                {"new_path": "d.py", "too_large": True},
            ]
        elif path.endswith("/discussions"):
            data = [
                {
                    "notes": [
                        {
                            "id": 1,
                            "author": {"username": "sam"},
                            "body": "check",
                            "position": {"new_path": "a.py", "new_line": 1},
                            "resolved": True,
                        },
                        {"system": True},
                    ]
                }
            ]
        else:
            data = [{"path": "a.py", "type": "blob"}]
        return httpx.Response(200, json=data)

    review = await client_for("gitlab", handler).load()
    assert [f.status for f in review.files] == ["added", "renamed", "deleted", "modified"]
    assert review.files[0].additions == 1
    assert review.comments[0].resolved
    assert review.files[3].patch_note


async def test_bitbucket_normalizes_diff_and_comments():
    def handler(request):
        path = request.url.path
        if path.endswith("/pullrequests/1"):
            return httpx.Response(
                200,
                json={
                    "title": "test",
                    "author": {"display_name": "sam"},
                    "source": {"commit": {"hash": "head"}, "branch": {"name": "feature"}},
                    "destination": {"commit": {"hash": "base"}, "branch": {"name": "main"}},
                },
            )
        if "/diffstat/" in path:
            return httpx.Response(
                200,
                json={
                    "values": [
                        {
                            "old": {"path": "old.py"},
                            "new": {"path": "a.py"},
                            "status": "renamed",
                            "lines_added": 1,
                            "lines_removed": 1,
                        }
                    ]
                },
            )
        if "/diff/" in path:
            return httpx.Response(
                200, text="diff --git a/old.py b/a.py\n--- a/old.py\n+++ b/a.py\n@@ -1 +1 @@\n-a\n+b"
            )
        return httpx.Response(
            200,
            json={
                "values": [
                    {
                        "id": 1,
                        "user": {"display_name": "sam"},
                        "content": {"raw": "review"},
                        "inline": {"path": "a.py", "to": 1},
                    },
                    {"deleted": True},
                ]
            },
        )

    review = await client_for("bitbucket", handler).load()
    assert review.files[0].previous_path == "old.py"
    assert review.files[0].patch.endswith("+b")
    assert review.comments[0].path == "a.py"
    assert review.warnings


async def test_azure_import_preserves_thread_paths_and_missing_patch_notice():
    def handler(request):
        path = request.url.path
        if path.endswith("/pullRequests/1"):
            data = {
                "title": "test",
                "createdBy": {"displayName": "sam"},
                "targetRefName": "refs/heads/main",
                "sourceRefName": "refs/heads/feature",
                "lastMergeTargetCommit": {"commitId": "base"},
                "lastMergeSourceCommit": {"commitId": "head"},
            }
        elif path.endswith("/iterations"):
            data = {"value": [{"id": 1}, {"id": 2}]}
        elif path.endswith("/changes"):
            assert "/iterations/2/" in path
            assert request.url.params["$compareTo"] == "0"
            data = {
                "nextSkip": 2000,
                "changeEntries": [
                    {"item": {"path": "/api/a.py"}, "changeType": "add"},
                    {"item": {"path": "/api", "isFolder": True}, "changeType": "add"},
                ],
            }
        elif path.endswith("/threads"):
            data = {
                "value": [
                    {
                        "id": 1,
                        "status": "fixed",
                        "threadContext": {"filePath": "/api/a.py", "rightFileStart": {"line": 4}},
                        "comments": [
                            {
                                "id": 1,
                                "commentType": "text",
                                "author": {"displayName": "sam"},
                                "content": "test",
                            },
                            {"commentType": "system"},
                        ],
                    }
                ]
            }
        else:
            data = {"value": [{"path": "/api/a.py"}, {"path": "/api", "isFolder": True}]}
        return httpx.Response(200, json=data)

    review = await client_for("azure", handler).load()
    assert review.files[0].path == "api/a.py"
    assert review.files[0].patch is None
    assert review.comments[0].resolved
    assert review.comments[0].line == 4
    assert review.tree == ["api/a.py"]
    assert len(review.warnings) == 3


@pytest.mark.parametrize(
    ("provider", "expected"),
    [
        ("github", "Bearer token"),
        ("gitlab", "token"),
        ("azure", "Basic OnRva2Vu"),
        ("bitbucket", "Bearer token"),
    ],
)
async def test_provider_credentials(provider, expected):
    client = client_for(provider, token="token")
    header = "PRIVATE-TOKEN" if provider == "gitlab" else "Authorization"
    assert client.http.headers[header] == expected
    await client.http.aclose()


async def test_bitbucket_account_token(monkeypatch):
    monkeypatch.setenv("BITBUCKET_EMAIL", "a@b.test")
    client = client_for("bitbucket", token="token")
    assert client.http.headers["Authorization"].startswith("Basic ")
    await client.http.aclose()


async def test_pagination_retains_provider_cursor_and_query():
    calls = []

    def handler(request):
        calls.append(request.url)
        if len(calls) == 1:
            return httpx.Response(
                200,
                json={
                    "values": [1],
                    "next": "https://api.bitbucket.org/2.0/repositories/a/b/files?cursor=abc&topic=true",
                },
            )
        assert request.url.params["cursor"] == "abc"
        assert request.url.params["topic"] == "true"
        return httpx.Response(200, json={"values": [2]})

    client = client_for("bitbucket", handler)
    assert await client.pages("/files", key="values") == [1, 2]
    await client.http.aclose()


async def test_gitlab_and_github_pagination_and_limit(monkeypatch):
    count = 0

    def handler(request):
        nonlocal count
        count += 1
        return httpx.Response(200, json=[count], headers={"x-next-page": str(count + 1)})

    monkeypatch.setattr("review_helper.providers.MAX_PAGES", 2)
    client = client_for("gitlab", handler)
    assert await client.pages("/files") == [1, 2]
    assert client.warnings
    await client.http.aclose()
    count = 0

    def link_handler(request):
        nonlocal count
        count += 1
        return httpx.Response(
            200,
            json=[count],
            headers={"Link": '<https://api.github.com/repos/a/b/files?page=2&per_page=100>; rel="next"'}
            if count == 1
            else {},
        )

    client = client_for(handler=link_handler)
    assert await client.pages("/files") == [1, 2]
    await client.http.aclose()


async def test_pagination_rejects_external_origin_without_sending_secrets():
    calls = []

    def handler(request):
        calls.append(request.url.host)
        return httpx.Response(200, json={"values": [], "next": "https://evil.test/steal"})

    client = client_for("bitbucket", handler, "secret")
    with pytest.raises(ProviderError, match="outside"):
        await client.pages("/files", key="values")
    assert calls == ["api.bitbucket.org"]
    await client.http.aclose()


@pytest.mark.parametrize("status", [301, 302, 401, 403, 404, 429, 500])
async def test_provider_errors_are_safe(status):
    client = client_for(handler=lambda r: httpx.Response(status, text="sensitive upstream content"))
    with pytest.raises(ProviderError) as exc:
        await client.get("/pulls/1")
    assert "sensitive" not in str(exc.value)
    assert await client.optional("Tree", client.get("/tree"), []) == []
    assert client.warnings
    await client.http.aclose()


async def test_network_json_and_size_errors(monkeypatch):
    def fail(request):
        raise httpx.ConnectError("internal details", request=request)

    client = client_for(handler=fail)
    with pytest.raises(ProviderError, match="reach"):
        await client.get("/x")
    await client.http.aclose()
    client = client_for(handler=lambda r: httpx.Response(200, text="invalid"))
    with pytest.raises(ProviderError, match="invalid JSON"):
        await client.get("/x")
    monkeypatch.setattr("review_helper.providers.MAX_BODY", 2)
    with pytest.raises(ProviderError, match="8 MB"):
        await client.get("/x")
    await client.http.aclose()


async def test_unexpected_paginated_shape():
    client = client_for(handler=lambda r: httpx.Response(200, json={}))
    with pytest.raises(ProviderError, match="format"):
        await client.pages("/x")
    await client.http.aclose()


def test_diff_helpers():
    assert normalize_status("rename, edit") == "renamed"
    assert normalize_status("edit") == "modified"
    assert count_lines("--- a\n+++ b\n-old\n+new\n context") == (1, 1)
    assert count_lines(None) == (0, 0)
    assert split_patch("binary") == {}


async def test_sign_in_redirect_is_reported_as_sign_in_not_moved_repository():
    from review_helper.providers import SignInRequired

    def handler(request):
        return httpx.Response(302, headers={"location": "https://x.vssps.visualstudio.com/_signin?realm=a"})

    client = client_for("azure", handler)
    with pytest.raises(SignInRequired, match="sign-in"):
        await client.get("/pullRequests/1")
    await client.http.aclose()


async def test_bitbucket_pages_never_send_page_numbers():
    seen = []

    def handler(request):
        seen.append(dict(request.url.params))
        return httpx.Response(200, json={"values": [1]})

    client = client_for("bitbucket", handler)
    assert await client.pages("/src/abc/", key="values", params={"max_depth": 20}) == [1]
    assert seen == [{"pagelen": "100", "max_depth": "20"}]
    await client.http.aclose()


async def test_azure_falls_back_to_commit_comparison_when_iterations_need_sign_in():
    def handler(request):
        path = request.url.path
        if path.endswith("/pullRequests/1"):
            return httpx.Response(
                200,
                json={
                    "title": "Public",
                    "createdBy": {"displayName": "bot"},
                    "targetRefName": "refs/heads/main",
                    "sourceRefName": "refs/heads/topic",
                    "lastMergeTargetCommit": {"commitId": "base"},
                    "lastMergeSourceCommit": {"commitId": "head"},
                },
            )
        if path.endswith("/iterations"):
            return httpx.Response(302, headers={"location": "https://login.microsoftonline.com/x"})
        if path.endswith("/diffs/commits"):
            assert request.url.params["baseVersion"] == "base"
            assert request.url.params["targetVersion"] == "head"
            return httpx.Response(
                200,
                json={
                    "commonCommit": "merge-base",
                    "allChangesIncluded": False,
                    "changes": [
                        {"item": {"path": "/docs/new.md", "gitObjectType": "blob"}, "changeType": "add"},
                        {"item": {"path": "/docs", "gitObjectType": "tree"}, "changeType": "edit"},
                        {
                            "item": {"path": "/b.md", "gitObjectType": "blob"},
                            "changeType": "rename",
                            "sourceServerItem": "/a.md",
                        },
                    ],
                },
            )
        if path.endswith("/items") and "path" in request.url.params:
            version = request.url.params["versionDescriptor.version"]
            return httpx.Response(200, json={"content": f"text at {version}\n"})
        return httpx.Response(200, json={"value": []})

    review = await client_for("azure", handler).load()
    assert [f.path for f in review.files] == ["docs/new.md", "b.md"]
    assert review.files[1].status == "renamed" and review.files[1].previous_path == "a.md"
    assert review.base_sha == "merge-base" and review.head_sha == "head"
    assert any("need sign-in" in w for w in review.warnings)
    assert any("more than 2,000" in w for w in review.warnings)


async def test_gitlab_explains_discussions_need_a_token():
    def handler(request):
        path = request.url.path
        if path.endswith("/merge_requests/1"):
            return httpx.Response(
                200,
                json={
                    "title": "t",
                    "author": {"username": "u"},
                    "target_branch": "main",
                    "source_branch": "f",
                    "sha": "head",
                    "user_notes_count": 10,
                },
            )
        if path.endswith("/discussions"):
            return httpx.Response(401)
        return httpx.Response(200, json=[])

    review = await client_for("gitlab", handler).load()
    assert any("(10 comments)" in w and "GITLAB_TOKEN" in w for w in review.warnings)
