"""Provider-neutral snapshots and constrained generative UI plans."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Status = Literal["added", "modified", "deleted", "renamed", "unchanged"]
Provider = Literal["github", "gitlab", "azure", "bitbucket", "demo"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class FileChange(StrictModel):
    path: str
    status: Status
    previous_path: str | None = None
    additions: int = 0
    deletions: int = 0
    patch: str | None = None
    patch_note: str | None = None
    module: str = ""


class Comment(StrictModel):
    id: str
    author: str
    body: str
    path: str | None = None
    line: int | None = None
    url: str = ""
    resolved: bool = False


class HunkRef(StrictModel):
    path: str = Field(description="A changed file that this section shares with other sections.")
    hunks: list[int] = Field(
        min_length=1, max_length=500, description="0-based indices of the file's @@ hunks this section owns."
    )


class Section(StrictModel):
    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,64}$")
    title: str = Field(min_length=1, max_length=100)
    summary: str = Field(min_length=1, max_length=1000)
    files: list[str] = Field(min_length=1, max_length=500)
    rationale: str = Field(default="", max_length=1000)
    source: Literal["curated", "heuristic", "model"] = "model"
    # Omit for whole files. When a file serves several features, each section lists its hunks.
    hunks: list[HunkRef] = Field(default_factory=list, max_length=500)


class Relationship(StrictModel):
    source: str
    target: str
    label: str = Field(max_length=100)
    evidence: str = Field(min_length=1, max_length=500)
    kind: Literal["curated", "inferred", "verified"] = "inferred"


class ReviewPlan(StrictModel):
    sections: list[Section] = Field(min_length=1, max_length=40)
    relationships: list[Relationship] = Field(default_factory=list, max_length=300)


class LinkedIssue(StrictModel):
    key: str
    url: str
    summary: str = "Details not loaded"
    status: str = "Not loaded"
    issue_type: str = "Issue"
    assignee: str = ""
    priority: str = ""
    loaded: bool = False
    note: str = "Configure JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN to load this linked issue."


class Review(StrictModel):
    id: str
    provider: Provider
    url: str
    repository: str
    number: int
    title: str
    description: str = ""
    author: str
    base: str
    head: str
    base_sha: str
    head_sha: str
    files: list[FileChange]
    tree: list[str] = Field(default_factory=list)
    comments: list[Comment] = Field(default_factory=list)
    sections: list[Section] = Field(default_factory=list)
    relationships: list[Relationship] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    grouping: Literal["curated", "heuristic", "model"] = "heuristic"
    issues: list[LinkedIssue] = Field(default_factory=list)


class ImportRequest(StrictModel):
    url: str = Field(max_length=2000)
    token: str | None = Field(default=None, max_length=4096, exclude=True)


class PlanRequest(ReviewPlan):
    expected_head: str


class ReviewProgress(StrictModel):
    sections: list[str] = Field(default_factory=list, max_length=40)

    @field_validator("sections")
    @classmethod
    def unique(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(value))
