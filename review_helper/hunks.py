"""Hunk-level ownership: one changed file can be split across feature sections.

A section owns a whole file unless it lists hunk indices for that path. Indices are
0-based positions of "@@" headers in the file's unified diff.
"""

import re

from .models import Comment, FileChange, Review, Section

HEADER = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


def split_patch(patch: str | None) -> list[str]:
    """Return each hunk with its header. Text before the first header is dropped."""
    hunks: list[list[str]] = []
    for line in (patch or "").split("\n"):
        if HEADER.match(line):
            hunks.append([line])
        elif hunks:
            hunks[-1].append(line)
    return ["\n".join(h) for h in hunks]


def new_range(hunk: str) -> range:
    match = HEADER.match(hunk)
    start, count = int(match[3]), int(match[4] or 1)
    return range(start, start + max(count, 1))


def owned(section: Section, path: str) -> list[int] | None:
    """Hunk indices a section owns in a file, or None when it owns the whole file."""
    return next((ref.hunks for ref in section.hunks if ref.path == path), None)


def restrict(file: FileChange, indices: list[int] | None) -> FileChange:
    """The part of a file a section reviews, with counts and a note for the reader."""
    hunks = split_patch(file.patch)
    if indices is None or not hunks or len(indices) == len(hunks):
        return file
    chosen = [hunks[i] for i in sorted(indices)]
    lines = [line for hunk in chosen for line in hunk.split("\n")[1:]]
    return file.model_copy(
        update={
            "patch": "\n".join(chosen),
            "additions": sum(line.startswith("+") for line in lines),
            "deletions": sum(line.startswith("-") for line in lines),
            "patch_note": f"This section reviews {len(chosen)} of {len(hunks)} hunks in this file.",
        }
    )


def section_files(review: Review, section: Section) -> list[FileChange]:
    return [restrict(f, owned(section, f.path)) for f in review.files if f.path in section.files]


def comment_belongs(review: Review, section: Section, comment: Comment) -> bool:
    """A line comment on a split file goes to the section whose hunk contains the line."""
    file = next((f for f in review.files if comment.path in (f.path, f.previous_path)), None)
    if file is None or file.path not in section.files:
        return False
    indices = owned(section, file.path)
    if indices is None or comment.line is None:
        return True
    hunks = split_patch(file.patch)
    containing = [i for i, hunk in enumerate(hunks) if comment.line in new_range(hunk)]
    # A line outside every hunk is shown with the section that owns the first hunk.
    return any(i in indices for i in containing) if containing else 0 in indices


def validate_ownership(review: Review, sections: list[Section]) -> None:
    """Every hunk of every changed file belongs to exactly one section."""
    known = {f.path: len(split_patch(f.patch)) for f in review.files}
    for section in sections:
        for ref in section.hunks:
            if ref.path not in section.files:
                raise ValueError(f"Section {section.id} lists hunks for {ref.path} but not the file itself.")
            if len(set(ref.hunks)) != len(ref.hunks) or any(
                i < 0 or i >= known.get(ref.path, 0) for i in ref.hunks
            ):
                raise ValueError(f"Hunk indices for {ref.path} must be unique and exist in its diff.")
    for path, count in known.items():
        owners = [s for s in sections if path in s.files]
        if not owners:
            raise ValueError(f"{path} is not assigned to any section.")
        claims = [owned(s, path) for s in owners]
        if len(owners) == 1:
            if claims[0] is not None and sorted(claims[0]) != list(range(count)):
                raise ValueError(f"The only section with {path} must own all {count} of its hunks.")
            continue
        if any(c is None for c in claims):
            raise ValueError(f"{path} is in several sections; each must list the hunks it owns.")
        flat = [i for c in claims for i in c]
        if sorted(flat) != list(range(count)):
            raise ValueError(f"The hunks of {path} must be split so each belongs to exactly one section.")
