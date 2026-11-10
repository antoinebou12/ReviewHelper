"""Hunk-level sections: a file split across features, validated so every hunk has one owner."""

import pytest

from review_helper.analysis import apply_plan, section_detail
from review_helper.demo import demo_review
from review_helper.hunks import comment_belongs, restrict, split_patch, validate_ownership
from review_helper.models import Comment, HunkRef, ReviewPlan

APP = "api/app.py"


def plan(review):
    return ReviewPlan(sections=review.sections, relationships=review.relationships)


def section(review, section_id):
    return next(s for s in review.sections if s.id == section_id)


def test_split_patch_keeps_headers_and_drops_preamble():
    hunks = split_patch("diff --git a/x b/x\n@@ -1 +1 @@\n-a\n+b\n@@ -9,2 +9,3 @@ def f():\n x\n+y")
    assert [h.split("\n")[0] for h in hunks] == ["@@ -1 +1 @@", "@@ -9,2 +9,3 @@ def f():"]
    assert split_patch(None) == []


def test_section_detail_returns_only_owned_hunks_and_their_comments():
    review = demo_review()
    created = section_detail(review, "collections")
    retired = section_detail(review, "cleanup")
    app_created = next(f for f in created["files"] if f["path"] == APP)
    app_retired = next(f for f in retired["files"] if f["path"] == APP)
    assert "collections.router" in app_created["patch"] and "legacy_save" not in app_created["patch"]
    assert "legacy_save" in app_retired["patch"] and "collections.router" not in app_retired["patch"]
    assert (app_created["additions"], app_created["deletions"]) == (2, 0)
    assert (app_retired["additions"], app_retired["deletions"]) == (0, 2)
    assert "1 of 2 hunks" in app_retired["patch_note"]
    # The line comment sits in the second hunk, so only the clean-up section shows it.
    assert "c7" in [c["id"] for c in retired["comments"]]
    assert "c7" not in [c["id"] for c in created["comments"]]


def test_comment_outside_any_hunk_goes_to_the_first_hunk_owner():
    review = demo_review()
    outside = Comment(id="x", author="a", body="b", path=APP, line=500)
    file_wide = Comment(id="y", author="a", body="b", path=APP)
    assert comment_belongs(review, section(review, "collections"), outside)
    assert not comment_belongs(review, section(review, "cleanup"), outside)
    assert comment_belongs(review, section(review, "cleanup"), file_wide)
    assert not comment_belongs(review, section(review, "save"), file_wide)


def test_restrict_leaves_whole_files_untouched():
    file = next(f for f in demo_review().files if f.path == APP)
    assert restrict(file, None) is file
    assert restrict(file, [0, 1]) is file


def test_valid_split_plan_is_accepted():
    review = demo_review()
    result = apply_plan(review, plan(review))
    assert section(result, "cleanup").hunks == [HunkRef(path=APP, hunks=[1])]


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (lambda r: section(r, "cleanup").hunks.clear(), "each must list"),
        (lambda r: setattr(section(r, "cleanup").hunks[0], "hunks", [0]), "exactly one section"),
        (lambda r: setattr(section(r, "cleanup").hunks[0], "hunks", [5]), "exist in its diff"),
        (lambda r: setattr(section(r, "cleanup").hunks[0], "hunks", [1, 1]), "unique"),
        (lambda r: section(r, "save").hunks.append(HunkRef(path=APP, hunks=[0])), "not the file itself"),
        (lambda r: section(r, "cleanup").files.remove(APP), "not the file itself"),
    ],
)
def test_invalid_hunk_ownership_is_rejected(change, message):
    review = demo_review()
    change(review)
    with pytest.raises(ValueError, match=message):
        validate_ownership(review, review.sections)


def test_single_owner_must_take_every_hunk():
    review = demo_review()
    section(review, "cleanup").files.remove(APP)
    section(review, "cleanup").hunks.clear()
    with pytest.raises(ValueError, match="must own all 2"):
        validate_ownership(review, review.sections)
    section(review, "collections").hunks.clear()
    validate_ownership(review, review.sections)


def test_unassigned_file_and_duplicate_listing_are_rejected():
    review = demo_review()
    with pytest.raises(ValueError, match="not assigned"):
        validate_ownership(review, [s for s in review.sections if s.id != "migration"])
    duplicated = demo_review()
    section(duplicated, "save").files.append(section(duplicated, "save").files[0])
    with pytest.raises(ValueError, match="twice"):
        apply_plan(duplicated, plan(duplicated))
