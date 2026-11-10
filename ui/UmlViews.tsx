/** Simple sequence, class and use case views generated from the review data. */
import type { FileChange, Review, Section } from "./types";
import { statusSymbol } from "./types";
import {
  changedPrefix,
  dataModelOf,
  groupNames,
  layer,
  moduleKey,
  routeEdge,
  sequenceOf,
  symbolsOf,
  testMapOf,
  worstStatus,
} from "./uml";

export type UmlMode = "sequence" | "class" | "usecase" | "data" | "tests";
type Props = {
  review: Review;
  section?: Section;
  selected: string | null;
  zoom: number;
  onSelect: (path: string) => void;
  onSelectSection: (id: string) => void;
};

const clip = (text: string, n: number) =>
  text.length > n ? text.slice(0, n - 1) + "…" : text;
const moduleLabel = (key: string) => {
  const last = key.split("/").at(-1)!;
  return key === "root" ? "Repository root" : (groupNames[last] ?? last);
};

function Frame({
  label,
  width,
  height,
  zoom,
  children,
}: {
  label: string;
  width: number;
  height: number;
  zoom: number;
  children: React.ReactNode;
}) {
  return (
    <svg
      className="project-diagram uml"
      role="group"
      aria-label={label}
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: `${zoom * 100}%`, minWidth: 680 * zoom }}
    >
      <defs>
        <pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse">
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
      {children}
    </svg>
  );
}

function Clickable({
  file,
  selected,
  onSelect,
  children,
}: {
  file: FileChange;
  selected: string | null;
  onSelect: (path: string) => void;
  children: React.ReactNode;
}) {
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`${file.path}, ${file.status}`}
      aria-pressed={selected === file.path}
      className={`file-node ${file.status} in-section ${selected === file.path ? "selected" : ""}`}
      onClick={() => onSelect(file.path)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(file.path);
        }
      }}
    >
      <title>{file.path}</title>
      {children}
    </g>
  );
}

function Empty({ zoom, text }: { zoom: number; text: string }) {
  return (
    <Frame label="Empty diagram" width={680} height={200} zoom={zoom}>
      <text x={340} y={104} textAnchor="middle" className="uml-muted">
        {text}
      </text>
    </Frame>
  );
}

export function SequenceView({
  review,
  section,
  selected,
  zoom,
  onSelect,
}: Props) {
  if (!section)
    return <Empty zoom={zoom} text="Select a section to see its flow." />;
  const { participants, messages } = sequenceOf(review, section);
  if (!participants.length)
    return <Empty zoom={zoom} text="This section has no changed files." />;
  const step = 190;
  const cx = (i: number) => 110 + i * step;
  const index = new Map(participants.map((p, i) => [p.path, i]));
  const top = 112;
  const height = top + Math.max(1, messages.length) * 54 + 30;
  const width = Math.max(680, 40 + participants.length * step);
  return (
    <Frame label="Sequence diagram" width={width} height={height} zoom={zoom}>
      {participants.map((file, i) => (
        <g key={file.path}>
          <line
            x1={cx(i)}
            y1={70}
            x2={cx(i)}
            y2={height - 12}
            className="seq-lifeline"
          />
          <Clickable file={file} selected={selected} onSelect={onSelect}>
            <rect x={cx(i) - 85} y={20} width={170} height={50} rx="8" />
            <text x={cx(i)} y={41} textAnchor="middle" className="node-name">
              {statusSymbol[file.status]}{" "}
              {clip(file.path.split("/").at(-1)!, 22)}
            </text>
            <text x={cx(i)} y={58} textAnchor="middle" className="node-path">
              {layer(file.path).name}
            </text>
          </Clickable>
        </g>
      ))}
      {messages.map((m, k) => {
        const a = index.get(m.from)!,
          b = index.get(m.to)!;
        const y = top + k * 54;
        if (a === b) {
          const x = cx(a);
          return (
            <g
              key={k}
              className={`seq-message ${m.inferred ? "inferred" : ""}`}
            >
              <path d={`M${x},${y} h36 v18 h-34`} markerEnd="url(#arrow)" />
              <text x={x + 42} y={y + 12} className="seq-label">
                {clip(m.label, 26)}
              </text>
            </g>
          );
        }
        const x1 = cx(a) + (b > a ? 4 : -4),
          x2 = cx(b) + (b > a ? -4 : 4);
        return (
          <g key={k} className={`seq-message ${m.inferred ? "inferred" : ""}`}>
            <text
              x={(x1 + x2) / 2}
              y={y - 7}
              textAnchor="middle"
              className="seq-label"
            >
              {k + 1}. {clip(m.label, Math.max(14, Math.abs(b - a) * 26))}
            </text>
            <line x1={x1} y1={y} x2={x2} y2={y} markerEnd="url(#arrow)" />
          </g>
        );
      })}
      {!messages.length && (
        <text x={cx(0)} y={top} className="uml-muted">
          No relationships recorded for this section.
        </text>
      )}
    </Frame>
  );
}

export function ClassView({
  review,
  section,
  selected,
  zoom,
  onSelect,
}: Props) {
  if (!section)
    return <Empty zoom={zoom} text="Select a section to see its classes." />;
  const files = review.files
    .filter((f) => section.files.includes(f.path))
    .slice(0, 9);
  if (!files.length)
    return <Empty zoom={zoom} text="This section has no changed files." />;
  const MAX = 7;
  const boxes = files.map((file) => {
    const symbols = symbolsOf(file);
    const rows = Math.max(
      1,
      Math.min(symbols.length, MAX) + (symbols.length > MAX ? 1 : 0),
    );
    return { file, symbols, h: 58 + rows * 20 + 10, x: 0, y: 0, channel: 0 };
  });
  let y = 24;
  for (let i = 0; i < boxes.length; i += 3) {
    const row = boxes.slice(i, i + 3);
    const rowH = Math.max(...row.map((b) => b.h));
    row.forEach((b, c) => {
      b.x = 24 + c * 320;
      b.y = y;
      b.channel = y + rowH + 25;
    });
    y += rowH + 50;
  }
  const byPath = new Map(boxes.map((b) => [b.file.path, b]));
  const stereotype = (path: string) =>
    /\.sql$/i.test(path)
      ? "table"
      : layer(path).rank === 6
        ? "test"
        : layer(path).rank === 0
          ? "component"
          : "module";
  return (
    <Frame
      label="Class diagram"
      width={Math.max(680, Math.min(3, boxes.length) * 320 + 16)}
      height={Math.max(260, y)}
      zoom={zoom}
    >
      {review.relationships.map((r, i) => {
        const a = byPath.get(r.source),
          b = byPath.get(r.target);
        if (!a || !b) return null;
        return (
          <path
            key={i}
            className={`relation active ${r.kind === "inferred" ? "inferred" : ""}`}
            d={routeEdge(
              { x: a.x, y: a.y + 24, w: 288, channel: a.channel },
              { x: b.x, y: b.y + 24, w: 288, channel: b.channel },
              (i % 5) - 2,
            )}
            markerEnd="url(#arrow)"
          >
            <title>{r.label}</title>
          </path>
        );
      })}
      {boxes.map(({ file, symbols, h, x, y }) => (
        <Clickable
          key={file.path}
          file={file}
          selected={selected}
          onSelect={onSelect}
        >
          <rect x={x} y={y} width={288} height={h} rx="8" />
          <text
            x={x + 144}
            y={y + 19}
            textAnchor="middle"
            className="uml-stereo"
          >
            «{stereotype(file.path)}»
          </text>
          <text
            x={x + 144}
            y={y + 37}
            textAnchor="middle"
            className="node-name"
          >
            {statusSymbol[file.status]} {clip(file.path.split("/").at(-1)!, 30)}
          </text>
          <line
            x1={x}
            y1={y + 48}
            x2={x + 288}
            y2={y + 48}
            className="uml-divider"
          />
          {symbols.slice(0, MAX).map((s, i) => (
            <text
              key={s.name + i}
              x={x + 14}
              y={y + 68 + i * 20}
              className={`uml-member ${s.state}`}
            >
              {statusSymbol[s.state]} {clip(s.name, 28)}
              {s.kind === "function"
                ? "()"
                : s.kind === "table"
                  ? " [table]"
                  : ""}
            </text>
          ))}
          {symbols.length > MAX && (
            <text x={x + 14} y={y + 68 + MAX * 20} className="uml-muted">
              +{symbols.length - MAX} more
            </text>
          )}
          {!symbols.length && (
            <text x={x + 14} y={y + 68} className="uml-muted">
              {file.patch ? "No definitions in the diff" : "Diff not available"}
            </text>
          )}
        </Clickable>
      ))}
    </Frame>
  );
}

export function UseCaseView({ review, section, zoom, onSelectSection }: Props) {
  const prefix = changedPrefix(review.files.map((f) => f.path));
  const files = new Map(review.files.map((f) => [f.path, f]));
  const modules = [
    ...new Set(review.files.map((f) => moduleKey(f.path, prefix))),
  ].slice(0, 12);
  const sections = review.sections.slice(0, 12);
  const caseY = (i: number) => 92 + i * 74;
  const modY = (j: number) => 76 + j * 58;
  const height =
    Math.max(caseY(sections.length - 1), modY(modules.length - 1)) + 80;
  const actorY = (caseY(0) + caseY(Math.max(0, sections.length - 1))) / 2;
  return (
    <Frame label="Use case diagram" width={860} height={height} zoom={zoom}>
      <rect
        x={170}
        y={24}
        width={400}
        height={height - 48}
        rx="14"
        className="uc-boundary"
      />
      <text x={190} y={50} className="module-title">
        {clip(review.repository || "System", 40)}
      </text>
      <g className="uc-actor" transform={`translate(70 ${actorY - 40})`}>
        <circle cx={0} cy={0} r={11} />
        <path d="M0,11 V44 M-18,24 H18 M0,44 L-14,68 M0,44 L14,68" />
        <text x={0} y={88} textAnchor="middle" className="module-title">
          User
        </text>
      </g>
      {sections.map((s, i) => {
        const status = worstStatus(
          s.files.map((p) => files.get(p)).filter((f): f is FileChange => !!f),
        );
        const active = s.id === section?.id;
        const touched = new Set(s.files.map((p) => moduleKey(p, prefix)));
        return (
          <g key={s.id}>
            <line
              x1={84}
              y1={actorY - 6}
              x2={210}
              y2={caseY(i)}
              className={`uc-link ${active ? "active" : ""}`}
            />
            {modules.map((m, j) =>
              touched.has(m) ? (
                <line
                  key={m}
                  x1={530}
                  y1={caseY(i)}
                  x2={620}
                  y2={modY(j) + 20}
                  className={`uc-link touches ${active ? "active" : ""}`}
                />
              ) : null,
            )}
            <g
              role="button"
              tabIndex={0}
              aria-label={`Use case ${s.title}`}
              aria-pressed={active}
              className={`uc-case ${status} ${active ? "active" : ""}`}
              onClick={() => onSelectSection(s.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectSection(s.id);
                }
              }}
            >
              <ellipse cx={370} cy={caseY(i)} rx={160} ry={28} />
              <text
                x={370}
                y={caseY(i) - 2}
                textAnchor="middle"
                className="uc-title"
              >
                {clip(s.title, 34)}
              </text>
              <text
                x={370}
                y={caseY(i) + 14}
                textAnchor="middle"
                className="node-path"
              >
                {s.files.length} files
              </text>
            </g>
          </g>
        );
      })}
      {modules.map((m, j) => {
        const inModule = review.files.filter(
          (f) => moduleKey(f.path, prefix) === m,
        );
        return (
          <g
            key={m}
            className={`file-node ${worstStatus(inModule)} in-section`}
          >
            <rect x={620} y={modY(j)} width={220} height={40} rx="8" />
            <text x={634} y={modY(j) + 18} className="node-name">
              {clip(moduleLabel(m), 26)}
            </text>
            <text x={634} y={modY(j) + 32} className="node-path">
              {clip(m + "/", 30)} · {inModule.length} changed
            </text>
          </g>
        );
      })}
    </Frame>
  );
}

/** Tables and models this section creates or changes, with foreign keys. */
export function DataView({ review, section, selected, zoom, onSelect }: Props) {
  const files = review.files.filter((f) => section?.files.includes(f.path));
  const { entities, links } = dataModelOf(files);
  if (!entities.length)
    return <Empty zoom={zoom} text="No tables or models in this section." />;
  const MAX = 8;
  const boxes = entities.slice(0, 9).map((e) => ({
    e,
    h:
      50 +
      Math.max(
        1,
        Math.min(e.columns.length, MAX) + (e.columns.length > MAX ? 1 : 0),
      ) *
        20 +
      10,
    x: 0,
    y: 0,
    channel: 0,
  }));
  let y = 24;
  for (let i = 0; i < boxes.length; i += 3) {
    const row = boxes.slice(i, i + 3);
    const rowH = Math.max(...row.map((b) => b.h));
    row.forEach((b, c) => {
      b.x = 24 + c * 320;
      b.y = y;
      b.channel = y + rowH + 25;
    });
    y += rowH + 50;
  }
  const byKey = new Map(boxes.map((b) => [b.e.key, b]));
  const fileOf = new Map(review.files.map((f) => [f.path, f]));
  return (
    <Frame
      label="Data model diagram"
      width={Math.max(680, Math.min(3, boxes.length) * 320 + 16)}
      height={Math.max(220, y)}
      zoom={zoom}
    >
      {links.map((l, i) => {
        const a = byKey.get(l.from),
          b = byKey.get(l.to);
        if (!a || !b) return null;
        return (
          <path
            key={i}
            className="relation active"
            d={routeEdge(
              { x: a.x, y: a.y + 24, w: 288, channel: a.channel },
              { x: b.x, y: b.y + 24, w: 288, channel: b.channel },
              (i % 5) - 2,
            )}
            markerEnd="url(#arrow)"
          >
            <title>
              {l.label} references {l.to}
            </title>
          </path>
        );
      })}
      {boxes.map(({ e, h, x, y }) => {
        const body = (
          <>
            <rect x={x} y={y} width={288} height={h} rx="8" />
            <text x={x + 14} y={y + 21} className="uml-stereo">
              {e.state === "unchanged" ? "referenced table" : "table"}
            </text>
            <text x={x + 14} y={y + 38} className="node-name">
              {statusSymbol[e.state]} {clip(e.name, 30)}
            </text>
            <line
              x1={x}
              y1={y + 48}
              x2={x + 288}
              y2={y + 48}
              className="uml-divider"
            />
            {e.columns.slice(0, MAX).map((c, i) => (
              <text
                key={c.name + i}
                x={x + 14}
                y={y + 68 + i * 20}
                className={`uml-member ${c.state}`}
              >
                {c.state === "unchanged" ? "  " : statusSymbol[c.state] + " "}
                {clip(c.name, 18)}
                <tspan className="uml-type"> {clip(c.type, 14)}</tspan>
              </text>
            ))}
            {e.columns.length > MAX && (
              <text x={x + 14} y={y + 68 + MAX * 20} className="uml-muted">
                +{e.columns.length - MAX} more
              </text>
            )}
            {!e.columns.length && (
              <text x={x + 14} y={y + 68} className="uml-muted">
                Outside this PR
              </text>
            )}
          </>
        );
        const file = e.file ? fileOf.get(e.file) : undefined;
        return file ? (
          <Clickable
            key={e.key}
            file={{
              ...file,
              status: e.state === "unchanged" ? file.status : e.state,
            }}
            selected={selected}
            onSelect={onSelect}
          >
            {body}
          </Clickable>
        ) : (
          <g key={e.key} className="file-node unchanged nearby">
            {body}
          </g>
        );
      })}
    </Frame>
  );
}

/** Changed source files on the left, the changed tests that exercise them on the right. */
export function TestsView({
  review,
  section,
  selected,
  zoom,
  onSelect,
}: Props) {
  if (!section)
    return <Empty zoom={zoom} text="Select a section to see its tests." />;
  const { sources, tests, pairs } = testMapOf(review, section);
  if (!sources.length)
    return <Empty zoom={zoom} text="No source files in this section." />;
  const rows = Math.max(sources.length, tests.length);
  const at = (i: number) => 64 + i * 66;
  const height = at(rows) + 10;
  const sIndex = new Map(sources.map((f, i) => [f.path, i]));
  const tIndex = new Map(tests.map((f, i) => [f.path, i]));
  const untested = sources.filter(
    (s) => !pairs.some((p) => p.source === s.path),
  );
  return (
    <Frame label="Test map" width={680} height={height} zoom={zoom}>
      <text x={24} y={36} className="module-title">
        Changed code
      </text>
      <text x={400} y={36} className="module-title">
        Changed tests
      </text>
      {pairs.map((p, i) => {
        const a = sIndex.get(p.source)!,
          b = tIndex.get(p.target)!;
        const y1 = at(a) + 26,
          y2 = at(b) + 26;
        return (
          <path
            key={i}
            className="relation active"
            d={`M280,${y1} C340,${y1} 340,${y2} 400,${y2}`}
            markerEnd="url(#arrow)"
          />
        );
      })}
      {sources.map((f, i) => {
        const tested = !untested.includes(f);
        return (
          <Clickable
            key={f.path}
            file={f}
            selected={selected}
            onSelect={onSelect}
          >
            <rect x={24} y={at(i)} width={256} height={52} rx="8" />
            <text x={38} y={at(i) + 21} className="node-name">
              {statusSymbol[f.status]} {clip(f.path.split("/").at(-1)!, 26)}
            </text>
            <text
              x={38}
              y={at(i) + 39}
              className={tested ? "node-path" : "node-path untested"}
            >
              {tested ? layer(f.path).name : "No changed test covers this"}
            </text>
          </Clickable>
        );
      })}
      {tests.map((f, i) => (
        <Clickable
          key={f.path}
          file={f}
          selected={selected}
          onSelect={onSelect}
        >
          <rect x={400} y={at(i)} width={256} height={52} rx="8" />
          <text x={414} y={at(i) + 21} className="node-name">
            {statusSymbol[f.status]} {clip(f.path.split("/").at(-1)!, 26)}
          </text>
          <text x={414} y={at(i) + 39} className="node-path">
            {clip(f.path.split("/").slice(0, -1).join("/"), 30)}
          </text>
        </Clickable>
      ))}
      {!tests.length && (
        <text x={400} y={at(0) + 30} className="uml-muted">
          This PR changes no tests.
        </text>
      )}
    </Frame>
  );
}

export function UmlView({ mode, ...props }: Props & { mode: UmlMode }) {
  if (mode === "sequence") return <SequenceView {...props} />;
  if (mode === "class") return <ClassView {...props} />;
  if (mode === "data") return <DataView {...props} />;
  if (mode === "tests") return <TestsView {...props} />;
  return <UseCaseView {...props} />;
}
