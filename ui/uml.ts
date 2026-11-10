/** Pure helpers that turn a review snapshot into simple UML-style views. */
import type { FileChange, Review, Section, Status } from "./types";

export type SymbolState = "added" | "modified" | "deleted";
export type CodeSymbol = {
  name: string;
  kind: "function" | "type" | "table";
  state: SymbolState;
};

const DEFINITIONS: [RegExp, CodeSymbol["kind"]][] = [
  [
    /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|def|func|fn)\s+([A-Za-z_$][\w$]*)/,
    "function",
  ],
  [
    /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
    "function",
  ],
  [
    /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function/,
    "function",
  ],
  [
    /^\s*(?:export\s+)?(?:public\s+|private\s+|abstract\s+|sealed\s+|data\s+)*(?:class|interface|struct|enum|trait|record)\s+([A-Za-z_$][\w$]*)/,
    "type",
  ],
  [/^\s*(?:export\s+)?type\s+([A-Z][\w$]*)\s*=/, "type"],
  [
    /^\s*(?:CREATE|ALTER)\s+TABLE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?["`]?([\w.]+)/i,
    "table",
  ],
];

function definition(line: string): Omit<CodeSymbol, "state"> | null {
  for (const [pattern, kind] of DEFINITIONS) {
    const match = pattern.exec(line);
    if (match) return { name: match[1], kind };
  }
  return null;
}

/**
 * Find the functions, types and tables a patch touches.
 * A definition only on + lines is added, only on - lines is deleted, and a definition
 * whose body (or hunk header context) contains changes is modified.
 */
export function symbolsOf(file: FileChange): CodeSymbol[] {
  if (!file.patch) return [];
  const seen = new Map<
    string,
    { kind: CodeSymbol["kind"]; plus: boolean; minus: boolean; body: boolean }
  >();
  let current: string | null = null;
  const touch = (name: string, kind: CodeSymbol["kind"]) => {
    const key = `${kind}:${name}`;
    if (!seen.has(key))
      seen.set(key, { kind, plus: false, minus: false, body: false });
    return seen.get(key)!;
  };
  for (const raw of file.patch.split("\n")) {
    if (raw.startsWith("@@")) {
      const header = definition(raw.replace(/^@@[^@]*@@\s?/, ""));
      current = header ? `${header.kind}:${header.name}` : null;
      if (header) touch(header.name, header.kind);
      continue;
    }
    const sign = raw[0];
    const found = definition(raw.slice(1));
    if (found) {
      const entry = touch(found.name, found.kind);
      if (sign === "+") entry.plus = true;
      else if (sign === "-") entry.minus = true;
      current = `${found.kind}:${found.name}`;
    } else if ((sign === "+" || sign === "-") && current) {
      seen.get(current)!.body = true;
    }
  }
  const result: CodeSymbol[] = [];
  for (const [key, entry] of seen) {
    const name = key.slice(key.indexOf(":") + 1);
    let state: SymbolState | null;
    if (file.status === "added") state = "added";
    else if (file.status === "deleted") state = "deleted";
    else if (entry.plus && entry.minus)
      state = "modified"; // signature changed
    else if (entry.plus) state = "added";
    else if (entry.minus) state = "deleted";
    else state = entry.body ? "modified" : null;
    if (state) result.push({ name, kind: entry.kind, state });
  }
  return result;
}

const LAYERS: [RegExp, number, string][] = [
  [
    /(^|\/)(tests?|spec|__tests__|e2e)(\/|$)|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+$/i,
    6,
    "Tests",
  ],
  // Most specific folders first: web/hooks is client state, api/services is a service.
  [
    /(^|\/)(db|models?|entities|repositor(y|ies)|schema|migrations?|prisma)(\/|$)|\.sql$/i,
    4,
    "Data",
  ],
  [/(^|\/)(services?|domain|usecases?|core|lib)(\/|$)/i, 3, "Service"],
  [/(^|\/)(hooks?|stores?|state|composables)(\/|$)/i, 1, "Client state"],
  [
    /(^|\/)(api|routes?|controllers?|handlers?|endpoints?|server)(\/|$)/i,
    2,
    "API",
  ],
  [
    /(^|\/)(pages?|views?|screens?|components?|ui|web|frontend|client|app)(\/|$)|\.(tsx|jsx|vue|svelte|html|css)$/i,
    0,
    "UI",
  ],
];

/** Rough request-flow order: UI → state → API → service → data, then tests. */
export function layer(path: string): { rank: number; name: string } {
  for (const [pattern, rank, name] of LAYERS)
    if (pattern.test(path)) return { rank, name };
  return { rank: 5, name: "Other" };
}

/** Directory prefix shared by every changed file, so groups start where the change starts. */
export function changedPrefix(paths: string[]): string {
  if (!paths.length) return "";
  const dirs = paths.map((p) => p.split("/").slice(0, -1));
  const first = dirs[0];
  let n = 0;
  while (n < first.length && dirs.every((d) => d[n] === first[n])) n++;
  return first
    .slice(0, n)
    .map((s) => s + "/")
    .join("");
}

/** Module for a path: the first folder below the changed prefix. Files directly in it share one group. */
export function moduleKey(path: string, prefix: string): string {
  if (prefix && path.startsWith(prefix)) {
    const rest = path.slice(prefix.length);
    return rest.includes("/")
      ? prefix + rest.split("/")[0]
      : prefix.slice(0, -1);
  }
  return path.includes("/") ? path.split("/")[0] : "root";
}

export function worstStatus(files: FileChange[]): Status {
  if (files.some((f) => f.status === "deleted"))
    return files.every((f) => f.status === "deleted") ? "deleted" : "modified";
  if (files.length && files.every((f) => f.status === "added")) return "added";
  return files.length ? "modified" : "unchanged";
}

export type Message = {
  from: string;
  to: string;
  label: string;
  inferred: boolean;
};

/** Participants and ordered messages for one section's sequence diagram. */
export function sequenceOf(review: Review, section: Section) {
  const files = new Map(review.files.map((f) => [f.path, f]));
  const participants = section.files
    .filter((p) => files.has(p))
    .sort((a, b) => layer(a).rank - layer(b).rank || a.localeCompare(b))
    .slice(0, 8);
  const inSet = new Set(participants);
  let messages: Message[] = review.relationships
    .filter((r) => inSet.has(r.source) && inSet.has(r.target))
    .sort(
      (a, b) =>
        layer(a.source).rank - layer(b.source).rank ||
        layer(a.target).rank - layer(b.target).rank,
    )
    .map((r) => ({
      from: r.source,
      to: r.target,
      label: r.label,
      inferred: r.kind === "inferred",
    }));
  if (!messages.length && participants.length > 1) {
    const flow = participants.filter((p) => layer(p).rank < 6);
    messages = flow.slice(1).map((to, i) => ({
      from: flow[i],
      to,
      label: "calls (inferred)",
      inferred: true,
    }));
  }
  return { participants: participants.map((p) => files.get(p)!), messages };
}

export type Box = { x: number; y: number; w: number; channel: number };
const COL = 320;
// Columns start at x=24 with 288-wide groups, so gutters sit 16px outside each group.
const col = (x: number) => Math.max(0, Math.round((x - 24) / COL));
const rightGutter = (c: number) => 24 + c * COL + 288 + 16;
const leftGutter = (c: number) => 24 + c * COL - 16;

/** Orthogonal route through column gutters and row channels so edges never cross cards. */
export function routeEdge(a: Box, b: Box, lane: number): string {
  const off = lane * 4;
  const ca = col(a.x),
    cb = col(b.x);
  const ya = a.y + off,
    yb = b.y + off;
  let pts: [number, number][];
  if (ca === cb && a.x === b.x && a.channel === b.channel) {
    // Same column and row: hug the right padding of the group.
    const gx = a.x + a.w + 8 + off;
    pts = [
      [a.x + a.w, ya],
      [gx, ya],
      [gx, yb],
      [b.x + b.w, yb],
    ];
  } else if (cb > ca || (cb === ca && b.x >= a.x)) {
    const ga = rightGutter(ca) + off;
    const gb = cb === ca ? ga : leftGutter(cb) + off;
    const end: [number, number] = cb === ca ? [b.x + b.w, yb] : [b.x, yb];
    pts =
      cb === ca || cb === ca + 1
        ? [[a.x + a.w, ya], [ga, ya], [ga, yb], end]
        : [
            [a.x + a.w, ya],
            [ga, ya],
            [ga, a.channel + off],
            [gb, a.channel + off],
            [gb, yb],
            end,
          ];
  } else {
    const ga = leftGutter(ca) + off;
    const gb = rightGutter(cb) + off;
    pts =
      cb === ca - 1
        ? [
            [a.x, ya],
            [ga, ya],
            [ga, yb],
            [b.x + b.w, yb],
          ]
        : [
            [a.x, ya],
            [ga, ya],
            [ga, a.channel + off],
            [gb, a.channel + off],
            [gb, yb],
            [b.x + b.w, yb],
          ];
  }
  return roundedPath(
    pts.filter(
      (p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1],
    ),
  );
}

function roundedPath(pts: [number, number][], r = 7): string {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1],
      [x, y] = pts[i],
      [nx, ny] = pts[i + 1];
    const r1 = Math.min(
      r,
      Math.hypot(x - px, y - py) / 2,
      Math.hypot(nx - x, ny - y) / 2,
    );
    const ux = Math.sign(x - px),
      uy = Math.sign(y - py),
      vx = Math.sign(nx - x),
      vy = Math.sign(ny - y);
    d += ` L${x - ux * r1},${y - uy * r1} Q${x},${y} ${x + vx * r1},${y + vy * r1}`;
  }
  const last = pts[pts.length - 1];
  return d + ` L${last[0]},${last[1]}`;
}
export const groupNames: Record<string, string> = {
  web: "Web application",
  frontend: "Frontend",
  api: "Application API",
  backend: "Backend",
  db: "Data & storage",
  tests: "Test suite",
  src: "Source",
  docs: "Documentation",
};

export type ImportLink = { source: string; target: string };
const JS_EXT = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".vue",
  ".svelte",
  "/index.ts",
  "/index.tsx",
  "/index.js",
];

function normalizePath(parts: string[]): string {
  const out: string[] = [];
  for (const part of parts) {
    if (part === "..") out.pop();
    else if (part && part !== ".") out.push(part);
  }
  return out.join("/");
}

/** Resolve import specifiers on changed lines to repository paths that exist in the tree. */
export function importsOf(file: FileChange, tree: Set<string>): string[] {
  if (!file.patch) return [];
  const dir = file.path.split("/").slice(0, -1);
  const found = new Set<string>();
  const tryPaths = (candidates: string[]) => {
    const hit = candidates.find((c) => tree.has(c) && c !== file.path);
    if (hit) found.add(hit);
  };
  for (const raw of file.patch.split("\n")) {
    if (!/^[+ ]/.test(raw)) continue;
    const line = raw.slice(1);
    // JavaScript / TypeScript: import … from "./x", require("./x"), import("./x")
    for (const m of line.matchAll(
      /(?:from\s+|require\(\s*|import\(\s*|import\s+)["'](\.{1,2}\/[^"']+)["']/g,
    )) {
      const base = normalizePath([...dir, ...m[1].split("/")]);
      tryPaths(JS_EXT.map((ext) => base + ext));
    }
    // Python: from a.b import c / from .b import c / import a.b
    const py = line.match(
      /^\s*(?:from\s+(\.*)([\w.]*)\s+import\s+([\w, ]+)|import\s+([\w.]+))/,
    );
    if (py && file.path.endsWith(".py")) {
      const dots = py[1] ?? "";
      const module = (py[2] ?? py[4] ?? "").split(".").filter(Boolean);
      const root = dots ? dir.slice(0, dir.length - (dots.length - 1)) : [];
      const names = (py[3] ?? "")
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean);
      const bases = [normalizePath([...root, ...module])];
      // "from api.services import collections" may name a submodule.
      for (const name of names)
        bases.push(normalizePath([...root, ...module, name]));
      for (const base of bases)
        if (base) tryPaths([base + ".py", base + "/__init__.py"]);
      // Repositories often keep packages under src/ or app/.
      for (const prefix of ["src/", "app/"])
        for (const base of bases) if (base) tryPaths([prefix + base + ".py"]);
    }
  }
  return [...found];
}

const GENERIC = new Set([
  "index",
  "main",
  "test",
  "tests",
  "spec",
  "util",
  "utils",
  "helper",
  "helpers",
  "type",
  "types",
  "api",
  "app",
  "page",
  "use",
  "init",
  "model",
  "models",
  "service",
  "services",
  "route",
  "routes",
  "lib",
  "config",
  "constant",
  "constants",
  "base",
  "common",
  "core",
  "the",
  "and",
  "for",
  "with",
]);

/** Meaningful words in a file name: useCollections.ts → collection, save.test.ts → save. */
export function nameTokens(path: string): string[] {
  const name = path
    .split("/")
    .at(-1)!
    .replace(/\.[^.]+$/, "");
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((t) => t.toLowerCase())
    .map((t) => (t.length > 4 && t.endsWith("s") ? t.slice(0, -1) : t))
    .filter((t) => t.length > 2 && !GENERIC.has(t) && !/^\d+$/.test(t));
}

/**
 * Unchanged files connected to the change, each with the reason it is shown:
 * imported by a changed line, linked by a review relationship, or named after a changed file.
 * Unrelated neighbours stay hidden; use the "All" scope for the full tree.
 */
export function nearbyFiles(review: Review, seeds: string[], perName = 2) {
  const tree = new Set([...review.tree, ...review.files.map((f) => f.path)]);
  const changed = new Map(review.files.map((f) => [f.path, f]));
  const seedSet = new Set(seeds);
  const reasons = new Map<string, string>();
  const add = (path: string, reason: string) => {
    if (!seedSet.has(path) && !changed.has(path) && !reasons.has(path))
      reasons.set(path, reason);
  };
  const short = (path: string) => path.split("/").at(-1)!;
  const links: ImportLink[] = [];
  for (const path of seeds) {
    const file = changed.get(path);
    if (!file) continue;
    for (const target of importsOf(file, tree)) {
      links.push({ source: path, target });
      add(target, `Imported by ${short(path)}`);
    }
  }
  for (const r of review.relationships) {
    if (seedSet.has(r.source) && tree.has(r.target))
      add(r.target, `${r.label} from ${short(r.source)}`);
    if (seedSet.has(r.target) && tree.has(r.source))
      add(r.source, `${r.label} to ${short(r.target)}`);
  }
  for (const path of seeds) {
    const tokens = new Set(nameTokens(path));
    if (!tokens.size) continue;
    review.tree
      .filter(
        (candidate) =>
          !changed.has(candidate) &&
          nameTokens(candidate).some((t) => tokens.has(t)),
      )
      .slice(0, perName)
      .forEach((candidate) => add(candidate, `Same name as ${short(path)}`));
  }
  return { paths: [...reasons.keys()], reasons, links };
}

export type Column = { name: string; type: string; state: Status };
export type Entity = {
  key: string;
  name: string;
  state: Status;
  columns: Column[];
  file?: string;
};
export type EntityLink = { from: string; to: string; label: string };
const entityKey = (name: string) => {
  const n = name.toLowerCase().replace(/^.*\./, "").replace(/["`]/g, "");
  return n.length > 3 && n.endsWith("s") ? n.slice(0, -1) : n;
};

/**
 * Tables and ORM models a diff creates or changes: SQL CREATE/ALTER TABLE and
 * Python classes with Column/mapped_column/Field attributes. Foreign keys become links;
 * a referenced table outside the PR appears as unchanged context.
 */
export function dataModelOf(files: FileChange[]) {
  const entities = new Map<string, Entity>();
  const links: EntityLink[] = [];
  const entity = (name: string, state: Status, file?: string) => {
    const key = entityKey(name);
    if (!entities.has(key))
      entities.set(key, { key, name, state, columns: [], file });
    const e = entities.get(key)!;
    if (e.state === "unchanged" && state !== "unchanged") e.state = state;
    e.file ??= file;
    return e;
  };
  const link = (from: string, to: string, label: string) => {
    if (
      entityKey(from) !== entityKey(to) &&
      !links.some((l) => l.from === entityKey(from) && l.to === entityKey(to))
    )
      links.push({ from: entityKey(from), to: entityKey(to), label });
  };
  for (const file of files) {
    if (!file.patch) continue;
    let current: Entity | null = null;
    let sqlOpen = false;
    for (const raw of file.patch.split("\n")) {
      if (raw.startsWith("@@")) {
        const ctx = raw.match(/class\s+(\w+)\s*\(/);
        current = ctx ? entity(ctx[1], "modified", file.path) : null;
        continue;
      }
      const sign = raw[0];
      const state: Status =
        file.status === "added" || sign === "+"
          ? "added"
          : file.status === "deleted" || sign === "-"
            ? "deleted"
            : "unchanged";
      const line = raw.slice(1);
      const create = line.match(
        /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([\w.]+)/i,
      );
      const alter = line.match(
        /ALTER\s+TABLE\s+["`]?([\w.]+)["`]?\s+ADD\s+(?:COLUMN\s+)?["`]?(\w+)["`]?\s+(\w+)/i,
      );
      const model = line.match(
        /^\s*class\s+(\w+)\s*\(([^)]*(?:Base|Model|Table|SQLModel|Document|Entity)[^)]*)\)/,
      );
      if (create) {
        current = entity(create[1], state, file.path);
        sqlOpen = true;
      } else if (alter) {
        const e = entity(alter[1], "modified", file.path);
        e.columns.push({ name: alter[2], type: alter[3], state });
        const ref = line.match(/REFERENCES\s+["`]?([\w.]+)/i);
        if (ref) link(alter[1], ref[1], alter[2]);
      } else if (model) {
        current = entity(model[1], state, file.path);
        sqlOpen = false;
      } else if (current && sqlOpen) {
        if (/^\s*\)\s*;?/.test(line)) {
          sqlOpen = false;
          continue;
        }
        // Several column definitions can share one line: "id UUID PRIMARY KEY, owner_id UUID".
        for (const part of line.split(/,(?![^(]*\))/)) {
          const col = part.match(
            /^\s*["`]?(\w+)["`]?\s+([A-Za-z]\w*(?:\(\d+\))?)/,
          );
          if (
            col &&
            !/^(PRIMARY|FOREIGN|CONSTRAINT|UNIQUE|CHECK|KEY|INDEX)$/i.test(
              col[1],
            )
          ) {
            current.columns.push({ name: col[1], type: col[2], state });
            const ref = part.match(/REFERENCES\s+["`]?([\w.]+)/i);
            if (ref) link(current.name, ref[1], col[1]);
          }
        }
      } else if (current && !sqlOpen) {
        const attr = line.match(
          /^\s+(\w+)\s*(?::\s*[\w\[\]., ]+)?=\s*(?:\w+\.)?(Column|mapped_column|Field|relationship)\(\s*(\w*)/,
        );
        if (attr && attr[2] !== "relationship") {
          current.columns.push({
            name: attr[1],
            type: attr[3] || attr[2],
            state,
          });
          const fk = line.match(/ForeignKey\(\s*["']([\w.]+)\.\w+["']/);
          if (fk) link(current.name, fk[1], attr[1]);
        }
        const table = line.match(/__tablename__\s*=\s*["'](\w+)["']/);
        if (table && entityKey(table[1]) !== current.key) {
          // Merge "class Collection" with its "collections" table.
          const other = entities.get(entityKey(table[1]));
          if (other) {
            current.columns.push(
              ...other.columns.filter(
                (c) => !current!.columns.some((x) => x.name === c.name),
              ),
            );
            entities.delete(other.key);
          }
          entities.delete(current.key);
          current.key = entityKey(table[1]);
          entities.set(current.key, current);
        } else if (!attr && /^\S/.test(line) && line.trim()) current = null;
      }
    }
  }
  for (const l of links)
    if (!entities.has(l.to))
      entities.set(l.to, {
        key: l.to,
        name: l.to,
        state: "unchanged",
        columns: [],
      });
  return { entities: [...entities.values()], links };
}

const isTest = (path: string) => layer(path).rank === 6;
const isCode = (path: string) =>
  /\.(py|ts|tsx|js|jsx|go|rs|java|kt|cs|rb|php|swift|vue|svelte)$/i.test(
    path,
  ) && !isTest(path);

/** Which changed tests exercise which changed source files, by relationship or shared name. */
export function testMapOf(review: Review, section: Section) {
  const files = review.files.filter((f) => section.files.includes(f.path));
  const sources = files.filter((f) => isCode(f.path) && f.status !== "deleted");
  const tests = review.files.filter((f) => isTest(f.path));
  const pairs: ImportLink[] = [];
  for (const t of tests) {
    const tokens = new Set(nameTokens(t.path));
    const imports = new Set(
      importsOf(t, new Set(review.files.map((f) => f.path))),
    );
    for (const s of sources) {
      const related =
        imports.has(s.path) ||
        review.relationships.some(
          (r) =>
            (r.source === t.path && r.target === s.path) ||
            (r.source === s.path && r.target === t.path),
        ) ||
        nameTokens(s.path).some((x) => tokens.has(x));
      if (related) pairs.push({ source: s.path, target: t.path });
    }
  }
  const usedTests = tests.filter(
    (t) =>
      pairs.some((p) => p.target === t.path) || section.files.includes(t.path),
  );
  return { sources, tests: usedTests, pairs };
}

/** Diagram types that have something to show for this review and section. */
export function availableDiagrams(review: Review, section?: Section): string[] {
  const modes: string[] = [];
  const sectionFiles = section
    ? review.files.filter((f) => section.files.includes(f.path))
    : [];
  if (review.files.length) modes.push("topology");
  const prefix = changedPrefix(review.files.map((f) => f.path));
  if (new Set(review.files.map((f) => moduleKey(f.path, prefix))).size > 1)
    modes.push("c4");
  if (review.sections.length > 1) modes.push("usecase");
  if (section && sequenceOf(review, section).messages.length)
    modes.push("sequence");
  // Tables belong to the data model view; the class view needs functions or types.
  if (sectionFiles.some((f) => symbolsOf(f).some((s) => s.kind !== "table")))
    modes.push("class");
  if (dataModelOf(sectionFiles).entities.some((e) => e.state !== "unchanged"))
    modes.push("data");
  if (section) {
    const map = testMapOf(review, section);
    if (map.sources.length && review.files.some((f) => isTest(f.path)))
      modes.push("tests");
  }
  return modes;
}
