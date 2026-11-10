export type Status = "added" | "modified" | "deleted" | "renamed" | "unchanged";
export interface FileChange {
  path: string;
  status: Status;
  previous_path: string | null;
  additions: number;
  deletions: number;
  patch: string | null;
  patch_note: string | null;
  module: string;
}
export interface Comment {
  id: string;
  author: string;
  body: string;
  path: string | null;
  line: number | null;
  url: string;
  resolved: boolean;
}
export interface Section {
  id: string;
  title: string;
  summary: string;
  files: string[];
  rationale: string;
  source: "curated" | "heuristic" | "model";
}
export interface Relationship {
  source: string;
  target: string;
  label: string;
  evidence: string;
  kind: string;
}
export interface Review {
  id: string;
  provider: string;
  url: string;
  repository: string;
  number: number;
  title: string;
  description: string;
  author: string;
  base: string;
  head: string;
  base_sha: string;
  head_sha: string;
  files: FileChange[];
  tree: string[];
  comments: Comment[];
  sections: Section[];
  relationships: Relationship[];
  warnings: string[];
  grouping: string;
  issues: LinkedIssue[];
}
export interface LinkedIssue {
  key: string;
  url: string;
  summary: string;
  status: string;
  issue_type: string;
  assignee: string;
  priority: string;
  loaded: boolean;
  note: string;
}
export const statusLabel: Record<Status, string> = {
  added: "Added",
  modified: "Modified",
  deleted: "Deleted",
  renamed: "Renamed",
  unchanged: "Unchanged",
};
export const statusSymbol: Record<Status, string> = {
  added: "+",
  modified: "~",
  deleted: "−",
  renamed: "↗",
  unchanged: "·",
};
export function safeLink(url: string): string | undefined {
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.href : undefined;
  } catch {
    return undefined;
  }
}
