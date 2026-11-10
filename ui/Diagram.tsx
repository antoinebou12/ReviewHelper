import { useMemo, useState } from "react";
import { Minus, Plus, Scan, Download } from "lucide-react";
import type { Review, Section, Status } from "./types";
import { statusLabel, statusSymbol } from "./types";

type Node = {
  path: string;
  name: string;
  parent: string;
  status: Status;
  x: number;
  y: number;
  group: string;
  /** Center of the empty channel below this node's row, used for edge routing. */
  channel: number;
};

type Box = { x: number; y: number; w: number; channel: number };
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
        ? [[a.x, ya], [ga, ya], [ga, yb], [b.x + b.w, yb]]
        : [
            [a.x, ya],
            [ga, ya],
            [ga, a.channel + off],
            [gb, a.channel + off],
            [gb, yb],
            [b.x + b.w, yb],
          ];
  }
  return roundedPath(pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]));
}

function roundedPath(pts: [number, number][], r = 7): string {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1],
      [x, y] = pts[i],
      [nx, ny] = pts[i + 1];
    const r1 = Math.min(r, Math.hypot(x - px, y - py) / 2, Math.hypot(nx - x, ny - y) / 2);
    const ux = Math.sign(x - px),
      uy = Math.sign(y - py),
      vx = Math.sign(nx - x),
      vy = Math.sign(ny - y);
    d += ` L${x - ux * r1},${y - uy * r1} Q${x},${y} ${x + vx * r1},${y + vy * r1}`;
  }
  const last = pts[pts.length - 1];
  return d + ` L${last[0]},${last[1]}`;
}
const groupNames: Record<string, string> = {
  web: "Web application",
  frontend: "Frontend",
  api: "Application API",
  backend: "Backend",
  db: "Data & storage",
  tests: "Test suite",
  src: "Source",
  docs: "Documentation",
};

export function Diagram({
  review,
  section,
  selected,
  mode,
  onSelect,
}: {
  review: Review;
  section?: Section;
  selected: string | null;
  mode: "topology" | "c4";
  onSelect: (path: string) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [focused, setFocused] = useState(false);
  const active = new Set(section?.files ?? review.files.map((f) => f.path));
  const { nodes, groups, width, height, omitted } = useMemo(() => {
    const changes = new Map(review.files.map((f) => [f.path, f]));
    const all = [
      ...new Set([...review.files.map((f) => f.path), ...review.tree]),
    ];
    const eligible = all.filter(
      (path) =>
        (!onlyChanged || changes.has(path)) &&
        (!focused || !section || section.files.includes(path)),
    );
    // Keep every changed path before unchanged context when limiting a large graph.
    const paths = eligible.slice(0, 120);
    const roots = [
      ...new Set(
        paths.map((path) => (path.includes("/") ? path.split("/")[0] : "root")),
      ),
    ];
    const groupList = roots.map((root) => ({
      id: root,
      name: groupNames[root] ?? root,
      paths: paths.filter(
        (path) => (path.includes("/") ? path.split("/")[0] : "root") === root,
      ),
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
          nodeList.find((n) => n.group === g.id)?.channel ?? g.y + g.height + 25,
      })),
      width: Math.max(680, cols * 320 + 16),
      height: Math.max(430, y),
      omitted: eligible.length - paths.length,
    };
  }, [review, mode, onlyChanged, focused, section]);
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
          {mode === "topology" ? "Project topology" : "C4-style container map"}
        </span>
        <div>
          <label>
            <input
              type="checkbox"
              checked={focused}
              onChange={(e) => setFocused(e.target.checked)}
            />{" "}
            Focus section
          </label>
          <label>
            <input
              type="checkbox"
              checked={onlyChanged}
              onChange={(e) => setOnlyChanged(e.target.checked)}
            />{" "}
            Changed only
          </label>
        </div>
      </div>
      <div className="canvas-scroll">
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
              <rect x={g.x} y={g.y} width={g.width} height={g.height} rx="14" />
              <text x={g.x + 18} y={g.y + 27} className="module-title">
                {g.name}
              </text>
              <text x={g.x + 18} y={g.y + 46} className="module-path">
                {g.id}/ ·{" "}
                {
                  g.paths.filter((p) => review.files.some((f) => f.path === p))
                    .length
                }{" "}
                changed
              </text>
            </g>
          ))}
          {review.relationships
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
                  className={`file-node ${node.status} ${active.has(node.path) ? "in-section" : "outside-section"} ${selected === node.path ? "selected" : ""}`}
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
                  </title>
                  <rect x={node.x} y={node.y} width="256" height="53" rx="8" />
                  <text x={node.x + 12} y={node.y + 22} className="node-symbol">
                    {statusSymbol[node.status]}
                  </text>
                  <text x={node.x + 32} y={node.y + 22} className="node-name">
                    {node.name.length > 27
                      ? node.name.slice(0, 25) + "…"
                      : node.name}
                  </text>
                  <text x={node.x + 32} y={node.y + 40} className="node-path">
                    {node.parent.length > 29
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
                        <g key={status} className={`container-count ${status}`}>
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
      </div>
      <div className="canvas-footer">
        <span>
          {omitted > 0
            ? `${omitted} more paths; use the file list for all changes.`
            : mode === "c4"
              ? "Directory-derived containers; confirm runtime boundaries."
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
