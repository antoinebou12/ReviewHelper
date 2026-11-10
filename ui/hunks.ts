/**
 * Hunk-level sections, mirroring review_helper/hunks.py.
 * A section owns a whole file unless it lists 0-based "@@" hunk indices for that path.
 */
import type { Comment, FileChange, Review, Section } from "./types";

const HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function splitPatch(patch: string | null): string[] {
  const hunks: string[][] = [];
  for (const line of (patch ?? "").split("\n")) {
    if (HEADER.test(line)) hunks.push([line]);
    else if (hunks.length) hunks[hunks.length - 1].push(line);
  }
  return hunks.map((h) => h.join("\n"));
}

function newRange(hunk: string): [number, number] {
  const m = HEADER.exec(hunk)!;
  const start = Number(m[3]);
  return [start, start + Math.max(Number(m[4] ?? 1), 1)];
}

/** Hunk indices a section owns in a file, or null when it owns the whole file. */
export function owned(section: Section, path: string): number[] | null {
  return section.hunks?.find((ref) => ref.path === path)?.hunks ?? null;
}

/** Sections that review part (or all) of a file. */
export function owners(review: Review, path: string): Section[] {
  return review.sections.filter((s) => s.files.includes(path));
}

export function restrict(
  file: FileChange,
  indices: number[] | null,
): FileChange {
  const hunks = splitPatch(file.patch);
  if (!indices || !hunks.length || indices.length === hunks.length) return file;
  const chosen = [...indices].sort((a, b) => a - b).map((i) => hunks[i]);
  const lines = chosen.flatMap((h) => h.split("\n").slice(1));
  return {
    ...file,
    patch: chosen.join("\n"),
    additions: lines.filter((l) => l.startsWith("+")).length,
    deletions: lines.filter((l) => l.startsWith("-")).length,
    patch_note: `This section reviews ${chosen.length} of ${hunks.length} hunks in this file.`,
  };
}

/** The files of a section, cut down to the hunks it owns. */
export function sectionFiles(review: Review, section?: Section): FileChange[] {
  if (!section) return [];
  return review.files
    .filter((f) => section.files.includes(f.path))
    .map((f) => restrict(f, owned(section, f.path)));
}

/** A line comment on a split file belongs to the section whose hunk contains the line. */
export function commentBelongs(
  review: Review,
  section: Section,
  comment: Comment,
): boolean {
  const file = review.files.find(
    (f) => comment.path === f.path || comment.path === f.previous_path,
  );
  if (!file || !section.files.includes(file.path)) return false;
  const indices = owned(section, file.path);
  if (!indices || comment.line == null) return true;
  const containing = splitPatch(file.patch)
    .map((h, i) => [i, newRange(h)] as const)
    .filter(([, [start, end]]) => comment.line! >= start && comment.line! < end)
    .map(([i]) => i);
  return containing.length
    ? containing.some((i) => indices.includes(i))
    : indices.includes(0);
}
