"""Explainable fallback grouping and validation of model-proposed plans."""

import re
from collections import Counter, defaultdict
from pathlib import PurePosixPath

from .models import Review, ReviewPlan, Section

STOP_WORDS = frozenset(
    "src app apps web api backend frontend server client services components pages routes "
    "test tests spec specs py ts tsx js jsx index init utils common lib core v1 v2".split()
)


def module_for(path: str) -> str:
    parts = PurePosixPath(path).parts
    return "/".join(parts[:2]) if len(parts) > 2 else parts[0] if len(parts) > 1 else "root"


def words(path: str) -> set[str]:
    separated = re.sub(r"([a-z])([A-Z])", r"\1 \2", path)
    return {
        word.removesuffix("s")
        for word in re.findall(r"[a-zA-Z]{3,}", separated.lower())
        if word not in STOP_WORDS
    }


def group_review(review: Review) -> Review:
    """Group cross-layer files by shared domain words, with explicit uncertainty."""
    tokens = {file.path: words(file.path) for file in review.files}
    counts = Counter(word for group in tokens.values() for word in group)
    groups: dict[str, list[str]] = defaultdict(list)
    for file in review.files:
        file.module = module_for(file.path)
        candidates = sorted(tokens[file.path], key=lambda word: (-counts[word], word))
        key = candidates[0] if candidates else "supporting"
        groups[key].append(file.path)
    review.sections = [
        Section(
            id=f"section-{index}",
            title=f"{key.capitalize()} changes",
            summary=f"Review {len(paths)} changed file{'s' if len(paths) != 1 else ''} related to {key}.",
            files=paths,
            rationale="Grouped by shared domain words in paths. Confirm intent against the diff.",
            source="heuristic",
        )
        for index, (key, paths) in enumerate(sorted(groups.items(), key=lambda item: -len(item[1])))
    ]
    review.grouping = "heuristic"
    return review


def apply_plan(review: Review, plan: ReviewPlan) -> Review:
    """Reject invented paths, omitted files, duplicate ownership, and invalid edges."""
    changed = {file.path for file in review.files}
    assigned = [path for section in plan.sections for path in section.files]
    if len({section.id for section in plan.sections}) != len(plan.sections):
        raise ValueError("Section IDs must be unique.")
    if len(assigned) != len(set(assigned)):
        raise ValueError("Each changed file must belong to exactly one section.")
    if set(assigned) != changed:
        raise ValueError("The plan must include every changed file exactly once, with no invented paths.")
    known = changed | set(review.tree)
    for edge in plan.relationships:
        if edge.source not in known or edge.target not in known or edge.source == edge.target:
            raise ValueError("Relationships must connect two distinct known paths.")
        # A model assertion cannot promote an edge to verified repository evidence.
        edge.kind = "inferred"
    result = review.model_copy(deep=True)
    result.sections = [section.model_copy(update={"source": "model"}) for section in plan.sections]
    result.relationships = plan.relationships
    result.grouping = "model"
    return result


def section_detail(review: Review, section_id: str) -> dict:
    section = next((section for section in review.sections if section.id == section_id), None)
    if section is None:
        raise KeyError(section_id)
    files = [file for file in review.files if file.path in section.files]
    paths = set(section.files) | {file.previous_path for file in files if file.previous_path}
    return {
        "section": section.model_dump(),
        "files": [file.model_dump() for file in files],
        "comments": [comment.model_dump() for comment in review.comments if comment.path in paths],
    }


def compact_review(review: Review) -> dict:
    return {
        "id": review.id,
        "title": review.title,
        "head_sha": review.head_sha,
        "grouping": review.grouping,
        "file_count": len(review.files),
        "sections": [{"id": s.id, "title": s.title, "file_count": len(s.files)} for s in review.sections],
        "warnings": review.warnings,
    }
