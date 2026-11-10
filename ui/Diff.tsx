/** Original provider diff, as one unified column or side by side (old | new). */
import { useEffect, useState } from "react";
import { Columns2, FileCode2, Rows3, Split } from "lucide-react";
import type { FileChange, Section } from "./types";
import { statusLabel } from "./types";

export type DiffLayout = "unified" | "split";
type Kind = "hunk" | "context" | "added" | "deleted" | "meta";
export type Line = {
  kind: Kind;
  text: string;
  old: number | null;
  new: number | null;
};
export type SplitRow =
  { hunk: string } | { left: Line | null; right: Line | null };

export function parsePatch(patch: string): Line[] {
  let old = 0,
    next = 0;
  return patch.split("\n").map((text) => {
    const hunk = text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/);
    if (hunk) {
      old = Number(hunk[1]);
      next = Number(hunk[2]);
      return { kind: "hunk", text, old: null, new: null };
    }
    if (/^(---|\+\+\+|diff |index |\\)/.test(text))
      return { kind: "meta", text, old: null, new: null };
    if (text.startsWith("+"))
      return { kind: "added", text: text.slice(1), old: null, new: next++ };
    if (text.startsWith("-"))
      return { kind: "deleted", text: text.slice(1), old: old++, new: null };
    return { kind: "context", text: text.slice(1), old: old++, new: next++ };
  });
}

/** Pair each run of removed lines with the added lines that replace it. */
export function splitRows(lines: Line[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.kind === "hunk" || line.kind === "meta") {
      rows.push({ hunk: line.text });
      i++;
    } else if (line.kind === "context") {
      rows.push({ left: line, right: line });
      i++;
    } else {
      const removed: Line[] = [],
        added: Line[] = [];
      while (lines[i]?.kind === "deleted") removed.push(lines[i++]);
      while (lines[i]?.kind === "added") added.push(lines[i++]);
      for (let k = 0; k < Math.max(removed.length, added.length); k++)
        rows.push({ left: removed[k] ?? null, right: added[k] ?? null });
    }
  }
  return rows;
}

const KEY = "review-helper:diff-layout";
const EVENT = "review-helper:diff-layout";

/** One layout preference shared by every diff on the page and remembered per browser. */
export function useDiffLayout(): [DiffLayout, (v: DiffLayout) => void] {
  const read = (): DiffLayout => {
    try {
      return localStorage.getItem(KEY) === "split" ? "split" : "unified";
    } catch {
      return "unified";
    }
  };
  const [layout, setLayout] = useState<DiffLayout>(read);
  useEffect(() => {
    const sync = () => setLayout(read());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  return [
    layout,
    (value) => {
      try {
        localStorage.setItem(KEY, value);
      } catch {
        /* storage may be blocked inside MCP hosts */
      }
      setLayout(value);
      window.dispatchEvent(new Event(EVENT));
    },
  ];
}

const mark = (kind: Kind) =>
  kind === "added" ? "+" : kind === "deleted" ? "−" : " ";
const rowClass = (kind?: Kind) =>
  kind === "added"
    ? "added-line"
    : kind === "deleted"
      ? "deleted-line"
      : kind
        ? ""
        : "empty-side";

export function Diff({
  file,
  sharedWith = [],
  onOpenSection,
}: {
  file: FileChange;
  /** Other sections that review the remaining hunks of this file. */
  sharedWith?: Section[];
  onOpenSection?: (id: string) => void;
}) {
  const [layout, setLayout] = useDiffLayout();
  const lines = file.patch ? parsePatch(file.patch) : [];
  return (
    <div className="diff-block">
      <div className="diff-heading">
        <FileCode2 size={16} />
        <span>{file.path}</span>
        <span className={`status-label ${file.status}`}>
          {statusLabel[file.status]}
        </span>
        <span className="diff-count">
          <span>+{file.additions}</span>
          <span>−{file.deletions}</span>
        </span>
        {file.patch && (
          <div className="segmented diff-layout" aria-label="Diff layout">
            <button
              aria-pressed={layout === "unified"}
              className={layout === "unified" ? "active" : ""}
              onClick={() => setLayout("unified")}
              title="Unified"
            >
              <Rows3 size={13} /> Unified
            </button>
            <button
              aria-pressed={layout === "split"}
              className={layout === "split" ? "active" : ""}
              onClick={() => setLayout("split")}
              title="Side by side"
            >
              <Columns2 size={13} /> Split
            </button>
          </div>
        )}
      </div>
      {file.previous_path && file.previous_path !== file.path && (
        <div className="patch-note">Previously {file.previous_path}</div>
      )}
      {!file.patch ? (
        <div className="empty-small">
          {file.patch_note || "This file has no available text diff."}
        </div>
      ) : layout === "unified" ? (
        <div className="diff-scroll">
          <table className="diff-table" aria-label={`Diff for ${file.path}`}>
            <tbody>
              {lines.map((line, i) => (
                <tr
                  key={i}
                  className={
                    line.kind === "hunk" ? "hunk" : rowClass(line.kind)
                  }
                >
                  <td className="line-number">{line.old ?? ""}</td>
                  <td className="line-number">{line.new ?? ""}</td>
                  <td>
                    <code>
                      {line.kind === "hunk" || line.kind === "meta"
                        ? line.text
                        : mark(line.kind) + (line.text || " ")}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="diff-scroll">
          <table
            className="diff-table split"
            aria-label={`Side-by-side diff for ${file.path}`}
          >
            <colgroup>
              <col className="num" />
              <col />
              <col className="num" />
              <col />
            </colgroup>
            <thead className="visually-hidden">
              <tr>
                <th>Old line</th>
                <th>Original</th>
                <th>New line</th>
                <th>Changed</th>
              </tr>
            </thead>
            <tbody>
              {splitRows(lines).map((row, i) =>
                "hunk" in row ? (
                  <tr key={i} className="hunk">
                    <td colSpan={4}>
                      <code>{row.hunk}</code>
                    </td>
                  </tr>
                ) : (
                  <tr key={i}>
                    <td className={`line-number ${rowClass(row.left?.kind)}`}>
                      {row.left?.old ?? ""}
                    </td>
                    <td className={`side ${rowClass(row.left?.kind)}`}>
                      <code>
                        {row.left
                          ? mark(row.left.kind) + (row.left.text || " ")
                          : ""}
                      </code>
                    </td>
                    <td className={`line-number ${rowClass(row.right?.kind)}`}>
                      {row.right?.new ?? ""}
                    </td>
                    <td className={`side ${rowClass(row.right?.kind)}`}>
                      <code>
                        {row.right
                          ? mark(row.right.kind) + (row.right.text || " ")
                          : ""}
                      </code>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
      {file.patch && file.patch_note && (
        <div className="patch-note">{file.patch_note}</div>
      )}
      {sharedWith.length > 0 && (
        <div className="shared-note">
          <Split size={13} /> The rest of this file is reviewed in:
          {sharedWith.map((s) => (
            <button
              key={s.id}
              className="text-button"
              onClick={() => onOpenSection?.(s.id)}
            >
              {s.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
