import pytest

from review_helper.analysis import apply_plan, compact_review, group_review, module_for, section_detail
from review_helper.demo import demo_review
from review_helper.hunks import validate_ownership
from review_helper.models import FileChange, Relationship, ReviewPlan, Section


def plan_for(review):
    return ReviewPlan(sections=review.sections, relationships=review.relationships)


def test_demo_sections_cross_architecture_and_cover_every_change():
    review = demo_review()
    paths = [path for s in review.sections for path in s.files]
    # Every file is covered; api/app.py is split by hunks between two sections.
    assert set(paths) == {f.path for f in review.files}
    assert len(paths) == len(review.files) + 1
    validate_ownership(review, review.sections)
    assert {path.split("/")[0] for path in review.sections[0].files} == {"web", "api", "db", "tests"}
    assert {f.status for f in review.files} == {"added", "modified", "deleted"}
    assert len(compact_review(review)["sections"]) == 4


def test_grouping_uses_domain_across_layers():
    review = demo_review()
    review.files = [
        FileChange(path=p, status="modified")
        for p in ["web/pages/Invoices.tsx", "api/routes/invoices.py", "tests/test_invoices.py", "README.md"]
    ]
    result = group_review(review)
    assert len(result.sections[0].files) == 3
    assert result.sections[0].source == "heuristic"
    assert module_for("README.md") == "root"
    assert module_for("web/page.ts") == "web"


def test_empty_domain_tokens_still_get_a_section():
    review = demo_review()
    review.files = [FileChange(path="src/index.ts", status="added")]
    assert group_review(review).sections[0].title == "Supporting changes"


@pytest.mark.parametrize("failure", ["missing", "invented", "duplicate", "ids", "edge", "self"])
def test_invalid_model_plans_are_rejected(failure):
    review = demo_review()
    plan = plan_for(review).model_copy(deep=True)
    if failure == "missing":
        plan.sections.pop()
    elif failure == "invented":
        plan.sections[0].files[0] = "invented.py"
    elif failure == "duplicate":
        plan.sections[1].files.append(plan.sections[0].files[0])
    elif failure == "ids":
        plan.sections[1].id = plan.sections[0].id
    elif failure == "edge":
        plan.relationships[0].source = "invented.py"
    else:
        plan.relationships[0].target = plan.relationships[0].source
    with pytest.raises(ValueError):
        apply_plan(review, plan)


def test_model_cannot_claim_verified_edges():
    review = demo_review()
    plan = plan_for(review).model_copy(deep=True)
    plan.relationships[0].kind = "verified"
    result = apply_plan(review, plan)
    assert result.grouping == "model"
    assert result.relationships[0].kind == "inferred"
    assert review.grouping == "curated"


def test_section_scopes_comments_including_previous_path():
    review = demo_review()
    review.files[0].previous_path = "old.tsx"
    review.comments[0].path = "old.tsx"
    detail = section_detail(review, "collections")
    assert len(detail["files"]) == 7
    assert any(c["path"] == "old.tsx" for c in detail["comments"])
    assert not any(c["path"] is None for c in detail["comments"])
    with pytest.raises(KeyError):
        section_detail(review, "missing")


def test_section_schema_bounds_model_output():
    with pytest.raises(ValueError):
        Section(id="bad id", title="test", summary="test", files=["a"])
    with pytest.raises(ValueError):
        Relationship(source="a", target="b", label="calls", evidence="")
