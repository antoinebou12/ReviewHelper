# Prototype plan

Reviewers start with the behavior changed by a pull request. Each section groups files across the UI, API, data, and tests. A selected section highlights its files on the project map and exposes its original diff and provider comments.

## Initial implementation

1. Normalize provider data into typed review snapshots. Include base/head commit IDs, renamed and deleted files, comments, and explicit completeness warnings.
2. Ship a curated example of a saved-collections feature spanning several modules. Use a deterministic filename heuristic for imported PRs until a model submits a validated section plan.
3. Render the same React/TypeScript workspace as a local web app and a single-file MCP App. Generate diagrams from structured data; never execute model-generated HTML or SVG.
4. Expose compact MCP discovery and section-level reads, a plan-update tool, resources, a prompt, and a portable review skill. The calling chat model supplies reasoning without requiring a second model subscription.
5. Test provider normalization, grouping, plan validation, storage, API authorization, and MCP transport. Exercise the browser flows with Playwright, including keyboard navigation and both themes. Report coverage, cyclomatic complexity, CRAP scores, and dependency audit results.

## Design

A quiet sidebar holds searchable review sections. The central canvas is the largest surface. A details pane holds the selected section or file. Color marks changes, with symbols and labels alongside it. A project topology preserves unchanged context; a C4-style container map shows which parts of the system are affected. Inferred relationships are identified as inferred.

Use system typography, restrained borders, an 8 px spacing rhythm, and visible focus indicators. On narrow screens, the sidebar and inspector stack around a horizontally scrollable diagram.

## Seeing the MCP App locally

Run the server and open `http://127.0.0.1:8000/mcp-preview`. The page stands in for a chat host: it calls `open_review` on the real `/mcp/` endpoint, embeds the app, and forwards the app's tool calls, chat messages and fullscreen requests. Inline, the app is a compact card that starts with the map; fullscreen restores the section list and inspector. Screenshots: `docs/screenshots/mcp-inline.png`, `docs/screenshots/mcp-fullscreen-dark.png`.

Diagram types appear only when they have content for the selected section: topology, C4 (two or more modules), use case (two or more sections), sequence, class, data model (SQL/ORM changes) and tests (changed tests matched to changed code). A one-section PR hides the section list, and search appears from four sections.

## Following the prototype

- OAuth and per-user review isolation for a hosted multi-user service.
- Self-hosted provider allowlists, durable managed storage, background indexing, and large-repository pagination beyond the prototype limits.
- AST/import indexing and confirmed C4 architecture manifests; current maps must distinguish directory structure from runtime dependencies.
- Hunk-level ownership for files that contain several independent changes.
- Optional model API adapters and a separate context-free review pass, followed by comparison against a project-aware pass. No autonomous provider posting.
- Native provider write-back after draft-review and approval flows are designed.

## References

- [CodeRabbit Change Stack](https://www.coderabbit.ai/blog/introducing-change-stack-the-first-ai-native-code-review-interface): change cohorts and layer-scoped review.
- [MCP Apps quickstart](https://github.com/modelcontextprotocol/ext-apps/blob/main/docs/quickstart.md): tool/resource binding and host bridge.
- [Apple layout guidelines](https://developer.apple.com/design/human-interface-guidelines/layout): layout reference.
- [FastAPI on Vercel](https://vercel.com/docs/frameworks/backend/fastapi): Python deployment entry point.
