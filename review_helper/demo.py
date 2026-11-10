"""A fictional, hand-authored PR illustrating one feature across application layers."""

from .analysis import module_for
from .models import Comment, FileChange, HunkRef, LinkedIssue, Relationship, Review, Section


def demo_review() -> Review:
    changes = [
        (
            "web/pages/Collections.tsx",
            "added",
            44,
            0,
            '@@ -0,0 +1,8 @@\n+import { useCollections } from "../hooks/useCollections";\n+\n+export function Collections() {\n+  const { collections, create } = useCollections();\n+  return <CollectionGrid\n+    items={collections}\n+    onCreate={create} />;\n+}',
        ),
        (
            "web/hooks/useCollections.ts",
            "added",
            32,
            0,
            '@@ -0,0 +1,8 @@\n+import { api } from "../lib/api";\n+export function useCollections() {\n+  const { data, mutate } = useSWR("/api/collections");\n+  const create = async (name: string) => {\n+    await api.post("/api/collections", { name });\n+    await mutate();\n+  };\n+  return { collections: data ?? [], create };',
        ),
        (
            "api/routes/collections.py",
            "added",
            38,
            0,
            '@@ -0,0 +1,10 @@\n+from api.deps import current_user\n+@router.post("/collections", status_code=201)\n+async def create_collection(\n+    payload: CollectionCreate,\n+    user: User = Depends(current_user),\n+):\n+    return await collections.create(\n+        owner_id=user.id,\n+        name=payload.name,\n+    )',
        ),
        (
            "api/services/collections.py",
            "added",
            56,
            0,
            "@@ -0,0 +1,8 @@\n+from db.session import session\n+async def create(owner_id: UUID, name: str):\n+    collection = Collection(\n+        owner_id=owner_id, name=name.strip()\n+    )\n+    session.add(collection)\n+    await session.commit()\n+    return collection",
        ),
        (
            "db/models/collection.py",
            "added",
            24,
            0,
            '@@ -0,0 +1,6 @@\n+class Collection(Base):\n+    __tablename__ = "collections"\n+    id = Column(UUID, primary_key=True)\n+    owner_id = Column(UUID, ForeignKey("users.id"))\n+    name = Column(String(120), nullable=False)\n+    created_at = Column(DateTime, default=utcnow)',
        ),
        (
            "tests/api/test_collections.py",
            "added",
            47,
            0,
            '@@ -0,0 +1,6 @@\n+async def test_create_collection(client, user):\n+    response = await client.post(\n+        "/api/collections", json={"name": "Weekend reads"}\n+    )\n+    assert response.status_code == 201\n+    assert response.json()["owner_id"] == str(user.id)',
        ),
        (
            "web/components/SaveButton.tsx",
            "modified",
            18,
            9,
            "@@ -12,4 +12,5 @@\n export function SaveButton({ article }) {\n-  return <button onClick={() => save(article)}>Save</button>;\n+  return <CollectionPicker\n+    onSelect={(id) => saveToCollection(id, article)} />;\n }",
        ),
        (
            "api/routes/bookmarks.py",
            "modified",
            12,
            6,
            "@@ -8,4 +8,5 @@\n async def save_bookmark(payload, user):\n-    return await bookmarks.save(user.id, payload.url)\n+    collection = await collections.owned_by(payload.collection_id, user.id)\n+    return await bookmarks.save(user.id, payload.url, collection.id)\n ",
        ),
        (
            "api/services/bookmarks.py",
            "modified",
            9,
            3,
            "@@ -4,4 +4,4 @@\n-async def save(user_id, url):\n-    bookmark = Bookmark(user_id=user_id, url=url)\n+async def save(user_id, url, collection_id):\n+    bookmark = Bookmark(user_id=user_id, url=url, collection_id=collection_id)\n     return await repository.insert(bookmark)",
        ),
        (
            "db/migrations/014_collections.sql",
            "added",
            21,
            0,
            "@@ -0,0 +1,5 @@\n+CREATE TABLE collections (\n+  id UUID PRIMARY KEY, owner_id UUID REFERENCES users(id),\n+  name VARCHAR(120) NOT NULL\n+);\n+ALTER TABLE bookmarks ADD COLUMN collection_id UUID REFERENCES collections(id);",
        ),
        (
            "web/components/LegacySave.tsx",
            "deleted",
            0,
            26,
            '@@ -1,5 +0,0 @@\n-export function LegacySave({ article }) {\n-  const save = () => localStorage.setItem(article.id, "saved");\n-  return <button onClick={save}>\n-    Save for later\n-  </button>;\n-}',
        ),
        (
            "tests/web/save.test.ts",
            "modified",
            14,
            8,
            '@@ -1,4 +1,5 @@\n-test("saves locally", () => {\n-  expect(localStorage.getItem("article")).toBe("saved");\n+test("saves to a collection", async () => {\n+  await user.click(screen.getByRole("button", { name: "Save" }));\n+  expect(screen.getByText("Choose a collection")).toBeVisible();\n });',
        ),
        (
            "api/app.py",
            "modified",
            2,
            2,
            "@@ -3,5 +3,6 @@ from fastapi import FastAPI\n from api.routes import auth, bookmarks\n+from api.routes import collections\n \n app = FastAPI()\n app.include_router(auth.router)\n+app.include_router(collections.router)\n"
            "@@ -12,4 +13,3 @@ app.include_router(bookmarks.router)\n # Legacy endpoints\n-from api.routes import legacy_save\n-app.include_router(legacy_save.router)\n app.add_middleware(TimingMiddleware)",
        ),
    ]
    files = [
        FileChange(
            path=p,
            status=s,
            additions=a,
            deletions=d,
            patch=diff,
            module=module_for(p),
            patch_note="Demo excerpt; counts describe the fictional full file.",
        )
        for p, s, a, d, diff in changes
    ]
    sections = [
        Section(
            id="collections",
            title="Create a collection",
            summary="A new collections page connects to an authenticated API and a persistent collection model. Includes the first API test.",
            files=[f.path for f in files[:6]] + [files[12].path],
            hunks=[HunkRef(path=files[12].path, hunks=[0])],
            source="curated",
            rationale="Follow a collection from the page, through the API, to storage and its test.",
        ),
        Section(
            id="save",
            title="Save articles to collections",
            summary="The save action now asks for a collection. The API checks ownership before attaching an article.",
            files=[f.path for f in files[6:9]] + [files[11].path],
            source="curated",
            rationale="The picker and ownership check implement the same user action across the UI and API.",
        ),
        Section(
            id="migration",
            title="Prepare collection storage",
            summary="Create the collections table and add a nullable collection reference to existing bookmarks.",
            files=[files[9].path],
            source="curated",
            rationale="Review migration safety separately from the application behavior.",
        ),
        Section(
            id="cleanup",
            title="Retire the local save button",
            summary="Remove the old component that kept saved articles in browser storage.",
            files=[files[10].path, files[12].path],
            hunks=[HunkRef(path=files[12].path, hunks=[1])],
            source="curated",
            rationale="Confirm that no callers still depend on the removed component.",
        ),
    ]
    pairs = [
        (0, 1, "uses"),
        (1, 2, "POST /collections"),
        (2, 3, "creates"),
        (3, 4, "persists"),
        (5, 2, "tests"),
        (6, 7, "POST /bookmarks"),
        (7, 8, "saves"),
        (8, 4, "belongs to"),
        (9, 4, "defines"),
        (11, 6, "tests"),
        (12, 2, "registers"),
    ]
    return Review(
        id="demo",
        provider="demo",
        url="",
        repository="acme / reading-room",
        number=128,
        title="Give saved articles a home",
        author="alex.chen",
        base="main",
        head="feat/collections",
        base_sha="2a91b8e",
        head_sha="8f4c2d1",
        description="Organize saved articles into personal collections.",
        files=files,
        sections=sections,
        grouping="curated",
        tree=[f.path for f in files if f.status != "deleted"]
        + [
            "web/pages/Library.tsx",
            "web/pages/Settings.tsx",
            "web/pages/Profile.tsx",
            "web/pages/Home.tsx",
            "web/lib/api.ts",
            "web/lib/format.ts",
            "web/components/CollectionGrid.tsx",
            "web/components/Header.tsx",
            "api/routes/auth.py",
            "api/routes/users.py",
            "api/routes/health.py",
            "api/deps.py",
            "api/services/search.py",
            "db/models/user.py",
            "db/models/article.py",
            "db/session.py",
            "tests/api/test_auth.py",
            "tests/api/test_users.py",
            "docs/README.md",
            "scripts/seed.py",
        ],
        relationships=[
            Relationship(
                source=files[a].path,
                target=files[b].path,
                label=label,
                evidence="Hand-authored relationship in the fictional demo.",
                kind="curated",
            )
            for a, b, label in pairs
        ],
        comments=[
            Comment(
                id="c1",
                author="Maya Patel",
                path=files[3].path,
                line=2,
                body="Can we reject an empty name after trimming? A string of spaces currently reaches the database.",
            ),
            Comment(
                id="c2",
                author="Sam Rivera",
                path=files[5].path,
                line=1,
                body="Please add a case for an unauthenticated request and a collection owned by another user.",
            ),
            Comment(
                id="c3",
                author="Maya Patel",
                path=files[7].path,
                line=2,
                body="The ownership check belongs here. This covers the cross-account case.",
                resolved=True,
            ),
            Comment(
                id="c4",
                author="Jo Kim",
                path=files[9].path,
                line=5,
                body="Existing bookmarks will have no collection. Should the UI show an Unsorted group?",
            ),
            Comment(
                id="c7",
                author="Sam Rivera",
                path="api/app.py",
                line=14,
                body="Is anything outside the web app still calling the legacy save endpoint?",
            ),
            Comment(
                id="c5",
                author="Alex Chen",
                body="Example discussion: the migration keeps existing bookmarks readable.",
            ),
            Comment(
                id="c6",
                author="preview-bot[bot]",
                body=(
                    "[pb]: #eyJoaWRkZW4iOiJtZXRhZGF0YSJ9\n"
                    "<!-- deployment metadata -->\n"
                    "Preview for **reading-room** is ready. Learn more in the [docs](https://example.com/docs).\n\n"
                    "| Project | Status | Preview |\n| :--- | :--- | :--- |\n"
                    '| <a href="https://example.com/p"><img alt="" src="x" /></a> reading-room '
                    "| ![Ready](https://example.com/ready.svg) Ready "
                    "| [Open preview](https://preview.example.com) |\n"
                    "<script>alert(1)</script>"
                ),
            ),
        ],
        issues=[
            LinkedIssue(
                key="READ-42",
                url="https://example.atlassian.net/browse/READ-42",
                summary="Organize saved articles into collections",
                status="In review",
                issue_type="Story",
                assignee="Alex Chen",
                priority="Medium",
                loaded=True,
                note="Fictional issue for this example.",
            )
        ],
    )
