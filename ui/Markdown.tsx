/**
 * Small, safe Markdown renderer for provider comments.
 * It builds React elements only (never innerHTML), keeps https links, shows images as their
 * alt text, and drops hidden bot metadata such as HTML comments and link reference definitions.
 */
import type { ReactNode } from "react";
import { safeLink } from "./types";

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  nbsp: " ",
};

/** Turn the HTML that providers allow in comments into plain Markdown text. */
export function normalize(body: string): string {
  return (
    body
      .replace(/\r\n?/g, "\n")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
      // Link reference definitions ([vc]: #abc…) are invisible metadata in rendered Markdown.
      .replace(/^ {0,3}\[[^\]\n]+\]:[ \t]*\S+.*$/gm, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<img\b[^>]*?\balt="([^"]*)"[^>]*>/gi, (_, alt: string) =>
        alt ? `![${alt}]()` : "",
      )
      .replace(/<img\b[^>]*>/gi, "")
      .replace(
        /<a\b[^>]*?\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
        (_, href: string, text: string) => {
          const label = text.replace(/<[^>]+>/g, "").trim();
          return label ? `[${label}](${href})` : "";
        },
      )
      .replace(/<summary\b[^>]*>([\s\S]*?)<\/summary>/gi, "**$1**\n")
      .replace(/<\/?(p|div|details|table|tr|h[1-6])\b[^>]*>/gi, "\n")
      .replace(/<\/?[a-zA-Z][\w-]*(\s[^>]*)?>/g, "")
      .replace(
        /&(amp|lt|gt|quot|#39|nbsp);/g,
        (_, name: string) => ENTITIES[name],
      )
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

const INLINE =
  /(`[^`\n]+`)|(!\[([^\]]*)\]\(([^)\s]*)\))|(\[([^\]]+)\]\(([^)\s]+)\))|(\*\*([^*]+)\*\*|__([^_]+)__)|(~~([^~]+)~~)|(\*([^*\s][^*]*)\*|_([^_\s][^_]*)_)|(https:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

export function inline(text: string, keyBase = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${n++}`;
    if (m[1]) out.push(<code key={key}>{m[1].slice(1, -1)}</code>);
    else if (m[2]) {
      if (m[3])
        out.push(
          <span key={key} className="md-image">
            {m[3]}
          </span>,
        );
    } else if (m[5]) {
      const href = safeLink(m[7]);
      const label = inline(m[6], key);
      out.push(
        href ? (
          <a key={key} href={href} target="_blank" rel="noreferrer noopener">
            {label}
          </a>
        ) : (
          <span key={key}>{label}</span>
        ),
      );
    } else if (m[8])
      out.push(<strong key={key}>{inline(m[9] ?? m[10], key)}</strong>);
    else if (m[11]) out.push(<del key={key}>{inline(m[12], key)}</del>);
    else if (m[13]) out.push(<em key={key}>{inline(m[14] ?? m[15], key)}</em>);
    else if (m[16])
      out.push(
        <a key={key} href={m[16]} target="_blank" rel="noreferrer noopener">
          {m[16].length > 60 ? m[16].slice(0, 57) + "…" : m[16]}
        </a>,
      );
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());

export function Markdown({ text }: { text: string }) {
  const lines = normalize(text).split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = `b${i}`;
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = line.match(/^\s*(```|~~~)\s*([\w+-]*)/);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1]))
        body.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={key} className="md-code">
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push(
        <p key={key} className={`md-heading h${heading[1].length}`}>
          {inline(heading[2], key)}
        </p>,
      );
      i++;
      continue;
    }
    if (
      line.includes("|") &&
      /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(
        lines[i + 1] ?? "",
      )
    ) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim())
        rows.push(cells(lines[i++]));
      blocks.push(
        <div key={key} className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>
                {head.map((c, j) => (
                  <th key={j}>{inline(c, `${key}h${j}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {head.map((_, j) => (
                    <td key={j}>{inline(r[j] ?? "", `${key}r${ri}c${j}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]))
        quote.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push(
        <blockquote key={key} className="md-quote">
          <Markdown text={quote.join("\n")} />
        </blockquote>,
      );
      continue;
    }
    const listItem = /^\s*(?:[-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/;
    if (listItem.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: ReactNode[] = [];
      while (i < lines.length && listItem.test(lines[i])) {
        const [, task, content] = lines[i].match(listItem)!;
        items.push(
          <li key={i}>
            {task && (
              <span className="md-task">{/x/i.test(task) ? "☑" : "☐"} </span>
            )}
            {inline(content, `${key}l${i}`)}
          </li>,
        );
        i++;
      }
      blocks.push(
        ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>,
      );
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(```|~~~|#{1,6}\s|>|[-*+]\s|\d+[.)]\s)/.test(lines[i]) &&
      !(lines[i].includes("|") && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? ""))
    )
      para.push(lines[i++]);
    if (!para.length) para.push(lines[i++]);
    blocks.push(
      <p key={key}>
        {para.flatMap((p, j) =>
          j
            ? [<br key={`br${j}`} />, ...inline(p, `${key}p${j}`)]
            : inline(p, `${key}p${j}`),
        )}
      </p>,
    );
  }
  return <div className="markdown">{blocks}</div>;
}
