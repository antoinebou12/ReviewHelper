"""SQLite snapshots for a single-user self-hosted workspace."""

import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from .demo import demo_review
from .models import Review


def database_path() -> Path:
    default = "/tmp/review-helper.sqlite3" if os.getenv("VERCEL") else ".review-helper/reviews.sqlite3"
    return Path(os.getenv("REVIEW_HELPER_DB_PATH", default))


@contextmanager
def connect():
    path = database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=10)
    db.execute("CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, body TEXT NOT NULL)")
    db.execute("CREATE TABLE IF NOT EXISTS progress (id TEXT PRIMARY KEY, body TEXT NOT NULL)")
    try:
        with db:
            yield db
    finally:
        db.close()


def save(review: Review) -> Review:
    with connect() as db:
        db.execute("INSERT OR REPLACE INTO reviews VALUES (?, ?)", (review.id, review.model_dump_json()))
    return review


def get(review_id: str) -> Review:
    with connect() as db:
        row = db.execute("SELECT body FROM reviews WHERE id = ?", (review_id,)).fetchone()
    if row:
        return Review.model_validate_json(row[0])
    if review_id == "demo":
        return demo_review()
    raise KeyError(review_id)


def progress(review_id: str, sections: list[str] | None = None) -> list[str]:
    review = get(review_id)
    key = f"{review_id}:{review.head_sha}"
    valid = {section.id for section in review.sections}
    with connect() as db:
        if sections is not None:
            if not set(sections) <= valid:
                raise ValueError("Unknown section in review progress.")
            db.execute("INSERT OR REPLACE INTO progress VALUES (?, ?)", (key, json.dumps(sections)))
        row = db.execute("SELECT body FROM progress WHERE id = ?", (key,)).fetchone()
    return [section for section in json.loads(row[0]) if section in valid] if row else []
