"""Imports real public pull requests from every provider.

Network tests are opt-in: REVIEW_HELPER_LIVE=1 pytest -m live
They use merged PRs on public repositories, so file counts are stable.
"""

import os

import pytest

from review_helper.analysis import section_detail
from review_helper.hunks import split_patch, validate_ownership
from review_helper.providers import ProviderClient, parse_url

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(os.getenv("REVIEW_HELPER_LIVE") != "1", reason="set REVIEW_HELPER_LIVE=1"),
]

CASES = [
    ("https://github.com/antoinebou12/uml-mcp/pull/398", "github", 39),
    ("https://gitlab.com/gitlab-org/cli/-/merge_requests/4344", "gitlab", 1),
    ("https://bitbucket.org/atlassian/atlassian-connect-express/pull-requests/547", "bitbucket", 8),
    ("https://dev.azure.com/dnceng-public/public/_git/dotnet-public-wiki/pullrequest/5", "azure", 1),
]


@pytest.fixture(autouse=True)
def anonymous(monkeypatch):
    for name in ("GITHUB_TOKEN", "GITLAB_TOKEN", "AZURE_DEVOPS_TOKEN", "BITBUCKET_TOKEN", "JIRA_BASE_URL"):
        monkeypatch.delenv(name, raising=False)


@pytest.mark.parametrize(("url", "provider", "files"), CASES, ids=[c[1] for c in CASES])
async def test_public_pull_request_imports_without_a_token(url, provider, files):
    review = await ProviderClient(parse_url(url)).load()
    assert review.provider == provider and review.title and review.head_sha
    assert len(review.files) == files
    # Every changed file has its text diff, and every hunk has exactly one section.
    assert all(f.patch and split_patch(f.patch) for f in review.files)
    validate_ownership(review, review.sections)
    assert review.tree, "the project map needs the repository tree"
    detail = section_detail(review, review.sections[0].id)
    assert detail["files"]


async def test_live_provider_specific_notices():
    gitlab = await ProviderClient(parse_url(CASES[1][0])).load()
    assert any("GITLAB_TOKEN" in w for w in gitlab.warnings)
    azure = await ProviderClient(parse_url(CASES[3][0])).load()
    assert azure.comments, "public Azure threads are readable anonymously"
    bitbucket = await ProviderClient(parse_url(CASES[2][0])).load()
    assert len(bitbucket.comments) >= 30
