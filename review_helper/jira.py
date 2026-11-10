"""Discover linked Jira issues without following arbitrary URLs or leaking tokens."""

import asyncio
import json
import os
import re
from urllib.parse import urlsplit

import httpx

from .models import LinkedIssue, Review

LINK = re.compile(r"https://([a-zA-Z0-9.-]+)/browse/([A-Z][A-Z0-9_]*-\d+)\b")


def discover(review: Review) -> list[LinkedIssue]:
    text = "\n".join([review.title, review.description, *(c.body for c in review.comments)])
    found = {}
    for host, key in LINK.findall(text):
        url = f"https://{host.lower()}/browse/{key}"
        found[url] = LinkedIssue(key=key, url=url)
    return list(found.values())[:20]


def jira_origin() -> str | None:
    value = os.getenv("JIRA_BASE_URL", "").rstrip("/")
    parsed = urlsplit(value)
    # Cloud prototype only. A custom allowlist and SSRF controls are needed for Jira Data Center.
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or not re.fullmatch(r"[a-z0-9-]+\.atlassian\.net", parsed.hostname)
        or parsed.path
        or parsed.username
        or parsed.password
        or parsed.port
        or parsed.query
        or parsed.fragment
    ):
        return None
    return value


async def load_issues(review: Review, transport=None) -> list[LinkedIssue]:
    issues = discover(review)
    origin = jira_origin()
    email, token = os.getenv("JIRA_EMAIL"), os.getenv("JIRA_API_TOKEN")
    if not origin:
        return issues
    auth = httpx.BasicAuth(email, token) if email and token else None
    async with httpx.AsyncClient(
        timeout=15, follow_redirects=False, auth=auth, transport=transport
    ) as client:

        async def fetch(issue):
            if urlsplit(issue.url).netloc != urlsplit(origin).netloc:
                issue.note = "This link is outside the configured Jira site. Open it directly to review."
                return
            try:
                async with client.stream(
                    "GET",
                    f"{origin}/rest/api/3/issue/{issue.key}",
                    params={"fields": "summary,status,issuetype,assignee,priority"},
                ) as response:
                    if response.status_code != 200:
                        issue.note = "Issue unavailable. Check Jira permissions and server credentials."
                        return
                    body = bytearray()
                    async for chunk in response.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > 1_000_000:
                            issue.note = "Issue response exceeded the 1 MB limit."
                            return
                    fields = json.loads(body)["fields"]
                issue.summary = fields.get("summary", "")
                issue.status = (fields.get("status") or {}).get("name", "Unknown")
                issue.issue_type = (fields.get("issuetype") or {}).get("name", "Issue")
                issue.assignee = (fields.get("assignee") or {}).get("displayName", "Unassigned")
                issue.priority = (fields.get("priority") or {}).get("name", "")
                issue.loaded = True
                issue.note = ""
            except (httpx.HTTPError, ValueError, KeyError):
                issue.note = "Could not load issue details from Jira."

        await asyncio.gather(*(fetch(issue) for issue in issues))
    return issues
