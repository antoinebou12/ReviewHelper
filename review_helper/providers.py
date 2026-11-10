"""Read-only adapters for hosted providers. Never fetch an arbitrary user URL."""

import asyncio
import base64
import difflib
import json
import os
import re
from dataclasses import dataclass
from urllib.parse import quote, unquote, urljoin, urlsplit
from uuid import uuid4

import httpx

from .analysis import group_review
from .entra import entra
from .jira import load_issues
from .models import Comment, FileChange, Review

MAX_PAGES = 10
MAX_BODY = 8_000_000
TOKEN_ENV = {
    "github": "GITHUB_TOKEN",
    "gitlab": "GITLAB_TOKEN",
    "azure": "AZURE_DEVOPS_TOKEN",
    "bitbucket": "BITBUCKET_TOKEN",
}


class ProviderError(ValueError):
    """Safe, user-facing provider failure."""


@dataclass(frozen=True)
class PRLocation:
    provider: str
    repository: str
    number: int
    api: str
    url: str


def parse_url(url: str) -> PRLocation:
    parsed = urlsplit(url.strip())
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise ProviderError("Use an HTTPS pull request URL from a supported hosted provider.")
    path = unquote(parsed.path).rstrip("/")
    if any(part in (".", "..") for part in path.split("/")) or "%" in path or "\\" in path:
        raise ProviderError("Invalid pull request path.")
    host = parsed.hostname
    patterns = {
        "github.com": ("github", r"/([^/]+/[^/]+)/pull/(\d+)(?:/files|/commits)?"),
        "gitlab.com": ("gitlab", r"/(.+)/-/merge_requests/(\d+)(?:/diffs)?"),
        "bitbucket.org": ("bitbucket", r"/([^/]+/[^/]+)/pull-requests/(\d+)(?:/diff)?"),
        "dev.azure.com": ("azure", r"/([^/]+/[^/]+/_git/[^/]+)/pullrequest/(\d+)"),
    }
    if host not in patterns:
        raise ProviderError("Supported hosts: github.com, gitlab.com, dev.azure.com, bitbucket.org.")
    provider, pattern = patterns[host]
    match = re.fullmatch(pattern, path)
    if not match or int(match[2]) < 1:
        raise ProviderError("Paste a pull request URL, including its number.")
    repo, number = match[1], int(match[2])
    encoded = quote(repo, safe="/")
    if provider == "github":
        api = f"https://api.github.com/repos/{encoded}"
    elif provider == "gitlab":
        api = f"https://gitlab.com/api/v4/projects/{quote(repo, safe='')}"
    elif provider == "bitbucket":
        api = f"https://api.bitbucket.org/2.0/repositories/{encoded}"
    else:
        org, project, _, repository = repo.split("/")
        api = (
            f"https://dev.azure.com/{quote(org)}/{quote(project)}/_apis/git/repositories/{quote(repository)}"
        )
    return PRLocation(provider, repo, number, api, f"https://{host}{quote(path, safe='/')}")


class ProviderClient:
    def __init__(
        self,
        location: PRLocation,
        token: str | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self.location = location
        self.warnings: list[str] = []
        headers = {"Accept": "application/json", "User-Agent": "review-helper/0.1"}
        token = token or os.getenv(TOKEN_ENV[location.provider])
        if token:
            if location.provider == "gitlab":
                headers["PRIVATE-TOKEN"] = token
            elif location.provider == "azure":
                headers["Authorization"] = "Basic " + base64.b64encode(f":{token}".encode()).decode()
            elif location.provider == "bitbucket" and os.getenv("BITBUCKET_EMAIL"):
                pair = f"{os.environ['BITBUCKET_EMAIL']}:{token}"
                headers["Authorization"] = "Basic " + base64.b64encode(pair.encode()).decode()
            else:
                headers["Authorization"] = f"Bearer {token}"
        if location.provider == "azure" and not token:
            bearer = entra.token() or os.getenv("AZURE_DEVOPS_BEARER_TOKEN")
            if bearer:
                headers["Authorization"] = f"Bearer {bearer}"
        self.http = httpx.AsyncClient(
            headers=headers, timeout=25, follow_redirects=False, transport=transport
        )

    async def request(self, url: str, params: dict | None = None, *, raw: bool = False):
        # Pagination and provider redirects must remain on the configured API origin.
        if urlsplit(url).netloc != urlsplit(self.location.api).netloc or urlsplit(url).scheme != "https":
            raise ProviderError("The provider returned a link outside its API origin.")
        try:
            async with self.http.stream("GET", url, params=params) as response:
                if response.status_code in (301, 302, 307, 308):
                    raise ProviderError(
                        "The provider redirected this request. Use the current repository URL."
                    )
                if response.status_code >= 400:
                    messages = {
                        401: "Authentication failed. Check the provider token.",
                        403: "Access denied or provider rate limit reached.",
                        404: "Pull request not found, or the token cannot read this repository.",
                        429: "Provider rate limit reached. Try again later.",
                    }
                    raise ProviderError(
                        messages.get(response.status_code, "The provider could not load this review.")
                    )
                content = bytearray()
                async for chunk in response.aiter_bytes():
                    content.extend(chunk)
                    if len(content) > MAX_BODY:
                        raise ProviderError("Provider response exceeded the 8 MB prototype limit.")
                data = content.decode("utf-8", errors="replace")
                return (data if raw else json.loads(data)), response
        except json.JSONDecodeError as exc:
            raise ProviderError("The provider returned an invalid JSON response.") from exc
        except (httpx.HTTPError, UnicodeError) as exc:
            raise ProviderError("Could not reach the provider. Check connectivity and try again.") from exc

    async def get(self, path: str, params: dict | None = None, *, raw: bool = False):
        url = path if path.startswith("https://") else self.location.api + path
        return (await self.request(url, params, raw=raw))[0]

    async def pages(self, path: str, *, key: str | None = None, params: dict | None = None) -> list:
        url = self.location.api + path
        query = {"per_page": 100, "pagelen": 100, **(params or {}), "page": 1}
        items: list = []
        for page in range(1, MAX_PAGES + 1):
            data, response = await self.request(url, query)
            batch = data.get(key, []) if key else data
            if not isinstance(batch, list):
                raise ProviderError("Unexpected provider response format.")
            items.extend(batch)
            next_url = data.get("next") if isinstance(data, dict) else None
            next_page = response.headers.get("x-next-page")
            link = response.links.get("next", {}).get("url")
            if next_url or link:
                url, query = urljoin(url, next_url or link), None
            elif next_page:
                query = {"per_page": 100, **(params or {}), "page": int(next_page)}
            elif len(batch) < 100:
                return items
            elif key:
                return items
            else:
                query = {"per_page": 100, **(params or {}), "page": page + 1}
        self.warnings.append(f"Pagination stopped after {MAX_PAGES} pages; this snapshot may be incomplete.")
        return items

    async def optional(self, label: str, operation, default):
        try:
            return await operation
        except ProviderError:
            self.warnings.append(f"{label} could not be loaded; this snapshot is incomplete.")
            return default

    async def load(self) -> Review:
        try:
            review = await getattr(self, f"load_{self.location.provider}")()
            review.issues = await load_issues(review)
            review.warnings.extend(self.warnings)
            if not review.tree:
                review.warnings.append(
                    "Project map contains changed files only; the complete repository tree is unavailable."
                )
            return group_review(review)
        finally:
            await self.http.aclose()

    def review(self, **kwargs) -> Review:
        return Review(
            id=uuid4().hex,
            provider=self.location.provider,
            url=self.location.url,
            repository=self.location.repository,
            number=self.location.number,
            **kwargs,
        )

    async def load_github(self) -> Review:
        n = self.location.number
        pr = await self.get(f"/pulls/{n}")
        files, comments, general, tree = await asyncio.gather(
            self.pages(f"/pulls/{n}/files"),
            self.optional("Inline comments", self.pages(f"/pulls/{n}/comments"), []),
            self.optional("PR discussion", self.pages(f"/issues/{n}/comments"), []),
            self.optional(
                "Repository tree", self.get(f"/git/trees/{pr['head']['sha']}", {"recursive": 1}), {}
            ),
        )
        if tree.get("truncated"):
            self.warnings.append("GitHub truncated the repository tree.")
        if len(files) < pr.get("changed_files", len(files)):
            self.warnings.append("The provider returned only part of the changed-file list.")
        return self.review(
            title=pr["title"],
            description=pr.get("body") or "",
            author=pr["user"]["login"],
            base=pr["base"]["ref"],
            head=pr["head"]["ref"],
            base_sha=pr["base"]["sha"],
            head_sha=pr["head"]["sha"],
            files=[
                FileChange(
                    path=f["filename"],
                    status=normalize_status(f["status"]),
                    previous_path=f.get("previous_filename"),
                    additions=f["additions"],
                    deletions=f["deletions"],
                    patch=f.get("patch"),
                    patch_note=None if f.get("patch") else "Binary, oversized, or unavailable diff.",
                )
                for f in files
            ],
            tree=[item["path"] for item in tree.get("tree", []) if item["type"] == "blob"],
            comments=[
                Comment(
                    id=str(c["id"]),
                    author=c["user"]["login"],
                    body=c.get("body") or "",
                    path=c.get("path"),
                    line=c.get("line") or c.get("original_line"),
                    url=c.get("html_url", ""),
                )
                for c in comments + general
            ],
        )

    async def load_gitlab(self) -> Review:
        n = self.location.number
        pr = await self.get(f"/merge_requests/{n}")
        diffs, discussions, tree = await asyncio.gather(
            self.pages(f"/merge_requests/{n}/diffs"),
            self.optional("Discussions", self.pages(f"/merge_requests/{n}/discussions"), []),
            self.optional(
                "Repository tree",
                self.pages("/repository/tree", params={"recursive": True, "ref": pr["sha"]}),
                [],
            ),
        )
        refs = pr.get("diff_refs") or {}
        files = []
        for diff in diffs:
            patch = diff.get("diff")
            status = (
                "deleted"
                if diff.get("deleted_file")
                else "added"
                if diff.get("new_file")
                else ("renamed" if diff.get("renamed_file") else "modified")
            )
            a, d = count_lines(patch)
            files.append(
                FileChange(
                    path=diff["new_path"],
                    previous_path=diff.get("old_path"),
                    status=status,
                    additions=a,
                    deletions=d,
                    patch=patch,
                    patch_note="Diff omitted or collapsed by provider." if not patch else None,
                )
            )
        notes = [
            note
            for discussion in discussions
            for note in discussion.get("notes", [])
            if not note.get("system")
        ]
        return self.review(
            title=pr["title"],
            description=pr.get("description") or "",
            author=pr["author"]["username"],
            base=pr["target_branch"],
            head=pr["source_branch"],
            base_sha=refs.get("base_sha", ""),
            head_sha=pr["sha"],
            files=files,
            tree=[t["path"] for t in tree if t["type"] == "blob"],
            comments=[
                Comment(
                    id=str(c["id"]),
                    author=c["author"]["username"],
                    body=c["body"],
                    path=(c.get("position") or {}).get("new_path"),
                    line=(c.get("position") or {}).get("new_line"),
                    resolved=c.get("resolved", False),
                    url=f"{self.location.url}#note_{c['id']}",
                )
                for c in notes
            ],
        )

    async def load_bitbucket(self) -> Review:
        n = self.location.number
        pr = await self.get(f"/pullrequests/{n}")
        # Bitbucket's PR diff endpoints redirect. Resolve the documented comparison directly.
        source, destination = pr["source"]["commit"]["hash"], pr["destination"]["commit"]["hash"]
        spec = f"{source}..{destination}"
        diffs, comments, patch, tree = await asyncio.gather(
            self.pages(f"/diffstat/{spec}", key="values", params={"topic": "true"}),
            self.optional("Comments", self.pages(f"/pullrequests/{n}/comments", key="values"), []),
            self.optional("Diff", self.get(f"/diff/{spec}", {"topic": "true"}, raw=True), ""),
            self.optional(
                "Repository tree", self.pages(f"/src/{source}/", key="values", params={"max_depth": 20}), []
            ),
        )
        patches = split_patch(patch)
        files = []
        for item in diffs:
            path = (item.get("new") or item.get("old"))["path"]
            files.append(
                FileChange(
                    path=path,
                    status=normalize_status(item["status"]),
                    previous_path=(item.get("old") or {}).get("path"),
                    additions=item.get("lines_added", 0),
                    deletions=item.get("lines_removed", 0),
                    patch=patches.get(path),
                    patch_note=None if path in patches else "Diff unavailable.",
                )
            )
        if any(item.get("type") == "commit_directory" and item["path"].count("/") >= 19 for item in tree):
            self.warnings.append("Bitbucket tree traversal is limited to 20 directory levels.")
        return self.review(
            title=pr["title"],
            description=pr.get("description") or "",
            author=pr["author"]["display_name"],
            base=pr["destination"]["branch"]["name"],
            head=pr["source"]["branch"]["name"],
            base_sha=destination,
            head_sha=source,
            files=files,
            tree=[item["path"] for item in tree if item.get("type") == "commit_file"],
            comments=[
                Comment(
                    id=str(c["id"]),
                    author=c["user"]["display_name"],
                    body=c["content"]["raw"],
                    path=(c.get("inline") or {}).get("path"),
                    line=(c.get("inline") or {}).get("to") or (c.get("inline") or {}).get("from"),
                    url=c.get("links", {}).get("html", {}).get("href", ""),
                )
                for c in comments
                if not c.get("deleted")
            ],
        )

    async def load_azure(self) -> Review:
        n = self.location.number
        version = {"api-version": "7.1"}
        pr = await self.get(f"/pullRequests/{n}", version)
        iterations = await self.get(f"/pullRequests/{n}/iterations", version)
        latest = max(iterations["value"], key=lambda item: item["id"])
        iteration = latest["id"]
        base_sha = (latest.get("commonRefCommit") or {}).get("commitId")
        head_sha = (latest.get("sourceRefCommit") or pr["lastMergeSourceCommit"])["commitId"]
        changes, threads, tree = await asyncio.gather(
            self.get(
                f"/pullRequests/{n}/iterations/{iteration}/changes",
                {**version, "$compareTo": 0, "$top": 2000},
            ),
            self.optional("Threads", self.get(f"/pullRequests/{n}/threads", version), {}),
            self.optional(
                "Repository tree",
                self.get(
                    "/items",
                    {
                        **version,
                        "recursionLevel": "Full",
                        "versionDescriptor.versionType": "commit",
                        "versionDescriptor.version": pr["lastMergeSourceCommit"]["commitId"],
                    },
                ),
                {},
            ),
        )
        if changes.get("nextSkip"):
            self.warnings.append("Azure returned more than 2,000 changes; the snapshot is incomplete.")
        files = [
            FileChange(
                path=c["item"]["path"].lstrip("/"),
                status=normalize_status(c["changeType"]),
                previous_path=(c.get("originalPath") or "").lstrip("/") or None,
                patch_note="Patch unavailable: the provider did not supply the comparison base.",
            )
            for c in changes.get("changeEntries", [])
            if not c["item"].get("isFolder")
        ]
        if base_sha:
            semaphore = asyncio.Semaphore(4)

            async def hydrate(file):
                async with semaphore:
                    await self.azure_patch(file, base_sha, head_sha)

            await asyncio.gather(*(hydrate(file) for file in files[:80]))
            for file in files[80:]:
                file.patch_note = "Patch omitted: Azure prototype imports text for at most 80 changed files."
        else:
            self.warnings.append("Azure did not supply a merge base; text diffs could not be reconstructed.")
        comments = []
        for thread in threads.get("value", []):
            context = thread.get("threadContext") or {}
            for c in thread.get("comments", []):
                if c.get("commentType") != "text" or c.get("isDeleted"):
                    continue
                comments.append(
                    Comment(
                        id=f"{thread['id']}-{c['id']}",
                        author=c["author"]["displayName"],
                        body=c.get("content", ""),
                        path=(context.get("filePath") or "").lstrip("/") or None,
                        line=(context.get("rightFileStart") or context.get("leftFileStart") or {}).get(
                            "line"
                        ),
                        resolved=thread.get("status") in ("fixed", "closed"),
                        url=self.location.url,
                    )
                )
        if any(file.patch is None for file in files):
            self.warnings.append(
                "Some Azure patches are unavailable. Their line counts are not included in totals."
            )
        return self.review(
            title=pr["title"],
            description=pr.get("description") or "",
            author=pr["createdBy"]["displayName"],
            base=pr["targetRefName"].removeprefix("refs/heads/"),
            head=pr["sourceRefName"].removeprefix("refs/heads/"),
            base_sha=base_sha or pr["lastMergeTargetCommit"]["commitId"],
            head_sha=head_sha,
            files=files,
            comments=comments,
            tree=[i["path"].lstrip("/") for i in tree.get("value", []) if not i.get("isFolder")],
        )

    async def azure_content(self, path: str, sha: str) -> str:
        item = await self.get(
            "/items",
            {
                "api-version": "7.1",
                "path": "/" + path,
                "versionDescriptor.versionType": "commit",
                "versionDescriptor.version": sha,
                "includeContent": True,
                "includeContentMetadata": True,
                "$format": "json",
            },
        )
        content = item.get("content")
        if not isinstance(content, str) or item.get("contentMetadata", {}).get("isBinary"):
            raise ProviderError("Binary or unavailable content.")
        if len(content) > 200_000 or len(content.splitlines()) > 5000:
            raise ProviderError("File exceeds the text-diff size limit.")
        return content

    async def azure_patch(self, file: FileChange, base_sha: str, head_sha: str) -> None:
        try:
            before = (
                ""
                if file.status == "added"
                else await self.azure_content(file.previous_path or file.path, base_sha)
            )
            after = "" if file.status == "deleted" else await self.azure_content(file.path, head_sha)
            lines = difflib.unified_diff(
                before.splitlines(keepends=True),
                after.splitlines(keepends=True),
                fromfile="a/" + (file.previous_path or file.path),
                tofile="b/" + file.path,
            )
            file.patch = "".join(
                line if line.endswith("\n") else line + "\n\\ No newline at end of file\n" for line in lines
            )
            file.additions, file.deletions = count_lines(file.patch)
            file.patch_note = (
                "Unified diff reconstructed from the provider's merge-base and head file contents."
            )
        except ProviderError as exc:
            file.patch_note = str(exc)


def normalize_status(status: str) -> str:
    status = status.lower()
    if "rename" in status:
        return "renamed"
    return {
        "add": "added",
        "added": "added",
        "delete": "deleted",
        "removed": "deleted",
        "deleted": "deleted",
    }.get(status, "modified")


def count_lines(patch: str | None) -> tuple[int, int]:
    lines = (patch or "").splitlines()
    return (
        sum(line.startswith("+") and not line.startswith("+++") for line in lines),
        sum(line.startswith("-") and not line.startswith("---") for line in lines),
    )


def split_patch(patch: str) -> dict[str, str]:
    result = {}
    for block in re.split(r"(?m)^diff --git ", patch)[1:]:
        header, _, body = block.partition("\n")
        match = re.search(r" b/(.+)$", header)
        if match:
            result[match[1]] = body
    return result
