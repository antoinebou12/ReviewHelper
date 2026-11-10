import { useMemo, useState } from "react";
import { Minus, Plus, Scan, Download } from "lucide-react";
import type { Review, Section, Status } from "./types";
import { statusLabel, statusSymbol } from "./types";
import {
  changedPrefix,
  groupNames,
  moduleKey,
  nearbyFiles,
  routeEdge,
} from "./uml";
import { UmlView, type UmlMode } from "./UmlViews";

type Node = {
  path: string;
  name: string;
  parent: string;
  /** Why an unchanged file is shown in the Nearby scope. */
  reason?: string;
  status: Status;
  x: number;
  y: number;
  group: string;
  /** Center of the empty channel below this node's row, used for edge routing. */
  channel: number;
};

export type DiagramMode = "topology" | "c4" | UmlMode;
type FileScope = "changed" | "nearby" | "all";

export function Diagram({
  review,
  section,
  selected,
  mode,
  onSelect,
  onSelectSection,
}: {
  review: Review;
  section?: Section;
  selected: string | null;
  mode: DiagramMode;
  onSelect: (path: string) => void;
  onSelectSection: (id: string) => void;
}) {
  const [zoom, setZoom] = useState(1);
  // Default: the change plus the unchanged files around it, never the whole repository.
  const [scope, setScope] = useState<FileScope>("nearby");
  const uml = mode !== "topology" && mode !== "c4";
  const [focused, setFocused] = useState(false);
  const active = new Set(section?.files ?? review.files.map((f) => f.path));
  const { nodes, groups, width, height, omitted, hidden, links, nearbyCount } =
    useMemo(() => {
      const changes = new Map(review.files.map((f) => [f.path, f]));
      const seeds = review.files
        .map((f) => f.path)
        .filter((p) => !focused || !section || section.files.includes(p));
      const near = nearbyFiles(review, seeds);
      const context =
        scope === "all"
          ? review.tree.filter((p) => !changes.has(p))
          : scope === "nearby"
            ? near.paths
            : [];
      // Changed files first, so limiting a large graph never drops review work.
      const eligible = [...new Set([...seeds, ...context])];
      // Keep every changed path before unchanged context when limiting a large graph.
      const paths = eligible.slice(0, 120);
      // Group by the first folder below the directory every change shares (e.g. src/api, src/web).
      const prefix = changedPrefix(review.files.map((f) => f.path));
      const keyOf = (path: string) => moduleKey(path, prefix);
      const roots = [...new Set(paths.map(keyOf))].filter(
        // C4 shows only containers this PR touches.
        (root) =>
          mode !== "c4" ||
          paths.some((p) => keyOf(p) === root && changes.has(p)),
      );
      const hidden = new Set(paths.map(keyOf)).size - roots.length;
      const groupList = roots.map((root) => ({
        id: root,
        name:
          root === "root"
            ? "Repository root"
            : (groupNames[root.split("/").at(-1)!] ?? root.split("/").at(-1)!),
        paths: paths.filter((path) => keyOf(path) === root),
        x: 0,
        y: 0,
        height: 0,
        width: 288,
      }));
      const cols = Math.min(3, Math.max(1, roots.length));
      const nodeList: Node[] = [];
      let y = 24;
      for (let i = 0; i < groupList.length; i += cols) {
        const row = groupList.slice(i, i + cols);
        const horizontal =
          mode === "topology" &&
          row.length === 1 &&
          row[0].paths.length <= cols &&
          i > 0;
        const rowHeight = Math.max(
          ...row.map((g) =>
            mode === "c4" ? 180 : horizontal ? 140 : 75 + g.paths.length * 65,
          ),
        );
        row.forEach((g, col) => {
          g.x = 24 + col * 320;
          g.y = y;
          g.height =
            mode === "c4" ? 180 : horizontal ? 140 : 75 + g.paths.length * 65;
          g.width = horizontal ? cols * 320 - 32 : 288;
          g.paths.forEach((path, index) => {
            const parts = path.split("/");
            nodeList.push({
              path,
              name: parts.at(-1)!,
              parent: parts.slice(0, -1).join("/") || "/",
              reason: scope === "all" ? undefined : near.reasons.get(path),
              status: changes.get(path)?.status ?? "unchanged",
              x: g.x + 16 + (horizontal ? index * 320 : 0),
              y: y + 61 + (horizontal ? 0 : index * 65),
              group: g.id,
              channel: y + rowHeight + 25,
            });
          });
        });
        y += rowHeight + 50;
      }
      return {
        nodes: nodeList,
        groups: groupList.map((g) => ({
          ...g,
          channel:
            nodeList.find((n) => n.group === g.id)?.channel ??
            g.y + g.height + 25,
        })),
        width: Math.max(680, cols * 320 + 16),
        height: Math.max(430, y),
        omitted: eligible.length - paths.length,
        hidden,
        nearbyCount: near.paths.length,
        // Import edges found on changed lines, unless a review relationship already covers the pair.
        links: near.links
          .filter(
            (l) =>
              !review.relationships.some(
                (r) =>
                  (r.source === l.source && r.target === l.target) ||
                  (r.source === l.target && r.target === l.source),
              ),
          )
          .map((l) => ({
            ...l,
            label: "imports",
            evidence: "Import statement on a changed line",
            kind: "inferred",
          })),
      };
    }, [review, mode, scope, focused, section]);
  const byPath = new Map(nodes.map((node) => [node.path, node]));

  function exportSvg() {
    const svg = document.querySelector(".project-diagram");
    if (!svg) return;
    const copy = svg.cloneNode(true) as SVGElement;
    // Inline computed colors so exported diagrams retain the current theme.
    const originals = [svg, ...svg.querySelectorAll("*")];
    const clones = [copy, ...copy.querySelectorAll("*")];
    originals.forEach((node, i) => {
      const style = getComputedStyle(node);
      (clones[i] as SVGElement).style.cssText =
        `fill:${style.fill};stroke:${style.stroke};stroke-width:${style.strokeWidth};font-family:${style.fontFamily};font-size:${style.fontSize};font-weight:${style.fontWeight};opacity:${style.opacity}`;
    });
    copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const url = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(copy)], {
        type: "image/svg+xml",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "review-helper.svg";
    a.click();
    URL.revokeObjectURL(url);
  }
  const c4edges = new Set<string>();
  return (
    <div className="diagram-panel">
      <div className="canvas-options">
        <span>
          <span className="live-dot" />{" "}
          {
            {
              topology: "Project topology",
              c4: "C4-style container map",
              data: "Data model · tables and models changed in this section",
              tests: "Tests · which changed tests cover this section's code",
              sequence: "Sequence · how this section's files call each other",
              class: "Class view · functions and types changed in this section",
              usecase: "Use cases · each section as a user-facing feature",
            }[mode]
          }
        </span>
        {!uml && (
          <div>
            <label>
              <input
                type="checkbox"
                checked={focused}
                onChange={(e) => setFocused(e.target.checked)}
              />{" "}
              Focus section
            </label>
            <div
              className="segmented scope"
              role="group"
              aria-label="Files shown"
            >
              {(
                [
                  ["changed", "Changed", "Only files this PR changes"],
                  [
                    "nearby",
                    `Nearby${nearbyCount ? ` +${nearbyCount}` : ""}`,
                    "Changed files plus files they import and their folder neighbours",
                  ],
                  ["all", "All", "Every file in the repository tree"],
                ] as [FileScope, string, string][]
              ).map(([value, label, title]) => (
                <button
                  key={value}
                  title={title}
                  aria-pressed={scope === value}
                  className={scope === value ? "active" : ""}
                  onClick={() => setScope(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="canvas-scroll">
        {uml ? (
          <UmlView
            mode={mode}
            review={review}
            section={section}
            selected={selected}
            zoom={zoom}
            onSelect={onSelect}
            onSelectSection={onSelectSection}
          />
        ) : (
          <svg
            className="project-diagram"
            aria-label={
              mode === "topology"
                ? "Project change map"
                : "C4 container change map"
            }
            role="group"
            viewBox={`0 0 ${width} ${height}`}
            style={{ width: `${zoom * 100}%`, minWidth: 680 * zoom }}
          >
            <defs>
              <pattern
                id="dots"
                width="20"
                height="20"
                patternUnits="userSpaceOnUse"
              >
                <circle cx="1" cy="1" r="0.8" className="grid-dot" />
              </pattern>
              <marker
                id="arrow"
                markerWidth="6"
                markerHeight="6"
                refX="5"
                refY="3"
                orient="auto"
              >
                <path d="M0,0 L6,3 L0,6" className="arrow-fill" />
              </marker>
            </defs>
            <rect width={width} height={height} fill="url(#dots)" />
            {groups.map((g) => (
              <g key={g.id} className="module-group">
                <rect
                  x={g.x}
                  y={g.y}
                  width={g.width}
                  height={g.height}
                  rx="14"
                />
                <text x={g.x + 18} y={g.y + 27} className="module-title">
                  {g.name}
                </text>
                <text x={g.x + 18} y={g.y + 46} className="module-path">
                  {g.id === "root" ? "" : g.id + "/"} ·{" "}
                  {
                    g.paths.filter((p) =>
                      review.files.some((f) => f.path === p),
                    ).length
                  }{" "}
                  changed
                </text>
              </g>
            ))}
            {[...review.relationships, ...links]
              .map((edge, index) => {
                const a = byPath.get(edge.source),
                  b = byPath.get(edge.target);
                if (!a || !b) return null;
                const isActive = active.has(a.path) && active.has(b.path);
                const lane = (index % 5) - 2;
                let d: string;
                if (mode === "c4") {
                  if (a.group === b.group) return null;
                  const key = `${a.group}:${b.group}`;
                  if (c4edges.has(key)) return null;
                  c4edges.add(key);
                  const ga = groups.find((g) => g.id === a.group)!,
                    gb = groups.find((g) => g.id === b.group)!;
                  d = routeEdge(
                    { x: ga.x, y: ga.y + 96, w: 288, channel: ga.channel },
                    { x: gb.x, y: gb.y + 96, w: 288, channel: gb.channel },
                    lane,
                  );
                } else {
                  d = routeEdge(
                    { x: a.x, y: a.y + 27, w: 256, channel: a.channel },
                    { x: b.x, y: b.y + 27, w: 256, channel: b.channel },
                    lane,
                  );
                }
                return { edge, index, d, isActive };
              })
              .filter((e) => e !== null)
              // Draw section edges last so they sit above dimmed context edges.
              .sort((x, y) => Number(x.isActive) - Number(y.isActive))
              .map(({ edge, index, d, isActive }) => (
                <path
                  key={index}
                  d={d}
                  className={`relation ${isActive ? "active" : ""} ${edge.kind === "inferred" ? "inferred" : ""}`}
                  markerEnd="url(#arrow)"
                >
                  <title>
                    {edge.label}: {edge.evidence} ({edge.kind})
                  </title>
                </path>
              ))}
            {mode === "topology"
              ? nodes.map((node) => (
                  <g
                    key={node.path}
                    role="button"
                    tabIndex={0}
                    aria-label={`${node.path}, ${statusLabel[node.status]}`}
                    aria-pressed={selected === node.path}
                    className={`file-node ${node.status} ${node.reason ? "nearby" : ""} ${active.has(node.path) ? "in-section" : "outside-section"} ${selected === node.path ? "selected" : ""}`}
                    onClick={() => onSelect(node.path)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(node.path);
                      }
                    }}
                  >
                    <title>
                      {node.path} · {statusLabel[node.status]}
                      {node.reason ? ` · ${node.reason}` : ""}
                    </title>
                    <rect
                      x={node.x}
                      y={node.y}
                      width="256"
                      height="53"
                      rx="8"
                    />
                    <text
                      x={node.x + 12}
                      y={node.y + 22}
                      className="node-symbol"
                    >
                      {statusSymbol[node.status]}
                    </text>
                    <text x={node.x + 32} y={node.y + 22} className="node-name">
                      {node.name.length > 27
                        ? node.name.slice(0, 25) + "…"
                        : node.name}
                    </text>
                    <text
                      x={node.x + 32}
                      y={node.y + 40}
                      className={
                        node.reason ? "node-path node-reason" : "node-path"
                      }
                    >
                      {node.reason
                        ? node.reason.length > 34
                          ? node.reason.slice(0, 33) + "…"
                          : node.reason
                        : node.parent.length > 29
                          ? "…" + node.parent.slice(-27)
                          : node.parent}
                    </text>
                  </g>
                ))
              : groups.map((g) => {
                  const changed = review.files.filter((f) =>
                    g.paths.includes(f.path),
                  );
                  return (
                    <g key={g.id} className="container-details">
                      <text x={g.x + 18} y={g.y + 85}>
                        [Container · directory-derived]
                      </text>
                      <text x={g.x + 18} y={g.y + 112}>
                        {g.paths.filter((p) => active.has(p)).length} files in
                        this section
                      </text>
                      {(["added", "modified", "deleted"] as Status[]).map(
                        (status, i) => (
                          <g
                            key={status}
                            className={`container-count ${status}`}
                          >
                            <rect
                              x={g.x + 18 + i * 86}
                              y={g.y + 133}
                              width="76"
                              height="26"
                              rx="5"
                            />
                            <text x={g.x + 28 + i * 86} y={g.y + 151}>
                              {statusSymbol[status]}{" "}
                              {
                                changed.filter((f) =>
                                  status === "modified"
                                    ? ["modified", "renamed"].includes(f.status)
                                    : f.status === status,
                                ).length
                              }{" "}
                              {status === "modified"
                                ? "edit"
                                : status === "deleted"
                                  ? "del"
                                  : "new"}
                            </text>
                          </g>
                        ),
                      )}
                    </g>
                  );
                })}
          </svg>
        )}
      </div>
      <div className="canvas-footer">
        <span>
          {uml
            ? mode === "class"
              ? "Definitions found in the diff · + added, ~ changed, − removed"
              : mode === "sequence"
                ? "Order follows UI → API → service → data; dashed steps are inferred"
                : mode === "data"
                  ? "From SQL and ORM changes · arrows are foreign keys"
                  : mode === "tests"
                    ? "Matched by imports, relationships and file names"
                    : "Select a use case to open its section"
            : omitted > 0
              ? `${omitted} more paths; use the file list for all changes.`
              : mode === "c4"
                ? `Directory-derived containers${hidden ? ` · ${hidden} untouched hidden` : ""}; confirm runtime boundaries.`
                : review.grouping === "curated"
                  ? "Example relationships · select a file to inspect its diff"
                  : "Directory structure · model relationships are shown as inferred"}
        </span>
        <div className="zoom-controls">
          <button
            aria-label="Zoom out"
            onClick={() => setZoom((v) => Math.max(0.6, v - 0.2))}
          >
            <Minus size={15} />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            aria-label="Zoom in"
            onClick={() => setZoom((v) => Math.min(2, v + 0.2))}
          >
            <Plus size={15} />
          </button>
          <button aria-label="Reset zoom" onClick={() => setZoom(1)}>
            <Scan size={15} />
          </button>
          <button aria-label="Export SVG" onClick={exportSvg}>
            <Download size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
