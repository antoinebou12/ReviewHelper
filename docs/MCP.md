# MCP server

Endpoint: `http://127.0.0.1:8000/mcp/` (Streamable HTTP, stateless JSON). Stdio:
`uv run review-helper --stdio`.

## Tools the model sees

| Tool | What it does |
| --- | --- |
| `open_review(url)` | Imports a PR (or `demo`), shows the MCP App, and returns a compact index: title, head SHA, sections with file counts. No patches, so the first answer stays small. |
| `read_section(review_id, section_id)` | Returns one section's patches and comments. A file shared with other sections contributes only this section's hunks. |
| `propose_review_plan(review_id, expected_head, plan)` | Replaces the sections with the model's plan. Every changed file must be assigned. A file shared by several sections lists `{path, hunks}` so each hunk has one owner. Model relationships are always stored as *inferred*. |

## Tools only the app calls

`get_workspace`, `review_progress` and `provider_connection` are marked
`visibility: ["app"]`, so they cost the model no context.

## Resources and prompt

| URI | Content |
| --- | --- |
| `ui://review-helper/workspace.html` | The MCP App (`text/html;profile=mcp-app`) |
| `review://guide` | Workflow and evidence rules for models |
| `review://reviews/{id}/manifest` | Changed files with hunk headers, without patch bodies |
| `skill://review-helper/SKILL.md` | Portable review skill (also in [skills/review-pr](../skills/review-pr/SKILL.md)) |
| prompt `review_feature` | Reviews one section with a bounded context budget |

Repository text, comments and patches are treated as untrusted data. The server never runs
model-generated HTML, JavaScript or SVG, and it never posts to the provider.

## Seeing the app as a host would

Open `/mcp-preview`. The page imitates a chat host: it calls `open_review` on the real
endpoint, embeds the app, and passes along tool calls, chat messages, theme changes and
fullscreen requests. A log at the bottom shows each message.

## Client configuration

```json
{ "mcpServers": { "review-helper": { "url": "http://127.0.0.1:8000/mcp/" } } }
```

With an access token, add `"headers": { "Authorization": "Bearer <token>" }` when the
client supports headers.
