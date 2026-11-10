import httpx
import pytest

from review_helper.models import FileChange
from review_helper.providers import ProviderClient, parse_url


def make_client(handler):
    return ProviderClient(
        parse_url("https://dev.azure.com/a/b/_git/c/pullrequest/1"), transport=httpx.MockTransport(handler)
    )


@pytest.mark.parametrize("status", ["added", "modified", "deleted", "renamed"])
async def test_reconstructed_azure_patch(status):
    def handler(request):
        sha = request.url.params["versionDescriptor.version"]
        return httpx.Response(200, json={"content": "old" if sha == "base" else "new"})

    client = make_client(handler)
    file = FileChange(path="new.py", previous_path="old.py", status=status)
    await client.azure_patch(file, "base", "head")
    assert file.patch is not None
    assert file.additions == (0 if status == "deleted" else 1)
    assert file.deletions == (0 if status == "added" else 1)
    assert "\\ No newline at end of file" in file.patch
    await client.http.aclose()


@pytest.mark.parametrize(
    "data",
    [
        {"content": "binary", "contentMetadata": {"isBinary": True}},
        {},
        {"content": "x" * 200001},
        {"content": "x\n" * 5001},
    ],
)
async def test_azure_patch_is_explicit_when_content_unavailable(data):
    client = make_client(lambda r: httpx.Response(200, json=data))
    file = FileChange(path="a.py", status="modified")
    await client.azure_patch(file, "base", "head")
    assert file.patch is None
    assert file.patch_note
    await client.http.aclose()


async def test_azure_load_uses_common_commit_for_patch():
    def handler(request):
        path = request.url.path
        if path.endswith("/pullRequests/1"):
            data = {
                "title": "test",
                "createdBy": {"displayName": "sam"},
                "targetRefName": "refs/heads/main",
                "sourceRefName": "refs/heads/feature",
                "lastMergeTargetCommit": {"commitId": "target"},
                "lastMergeSourceCommit": {"commitId": "head"},
            }
        elif path.endswith("/iterations"):
            data = {
                "value": [
                    {
                        "id": 1,
                        "commonRefCommit": {"commitId": "common"},
                        "sourceRefCommit": {"commitId": "head"},
                    }
                ]
            }
        elif path.endswith("/changes"):
            data = {"changeEntries": [{"item": {"path": "/a.py"}, "changeType": "edit"}]}
        elif "includeContent" in request.url.params:
            sha = request.url.params["versionDescriptor.version"]
            assert sha in ("common", "head")
            data = {"content": "old\n" if sha == "common" else "new\n"}
        else:
            data = {"value": []}
        return httpx.Response(200, json=data)

    review = await make_client(handler).load()
    assert review.base_sha == "common"
    assert "+new" in review.files[0].patch
