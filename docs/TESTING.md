# Testing and quality checks

Each check below also runs in [CI](../.github/workflows/ci.yml).

## Unit, API and MCP protocol tests

```bash
uv run pytest
```

These cover provider normalisation (from recorded responses), grouping, hunk ownership,
plan validation, storage, access control, Entra and GitHub device sign-in, Jira, the MCP
linter, and real Streamable HTTP MCP requests. Coverage is measured on lines and branches,
and the run fails below 85%.

## End-to-end tests

```bash
npm ci && npm run build
npx playwright test
```

Playwright starts the server and covers:

- **Navigation:** sections, search, keyboard (`/`, `J`, `K`).
- **Diagrams:** every diagram type, the file scopes and SVG export.
- **Diffs and comments:** split diffs, hunk-split files, Markdown comment safety.
- **Layouts:** light and dark themes with axe accessibility checks, and the mobile layout.
- **MCP App:** inside a test host, including the compact card, fullscreen and chat messages.
- **Live host:** the `/mcp-preview` host against the real MCP endpoint.

`e2e/screenshots.spec.ts` regenerates the README images.

## Mutation testing

```bash
uv sync --extra mutation
uv run python scripts/mutation.py --min-score 80
```

[cosmic-ray](https://github.com/sixty-north/cosmic-ray) changes `hunks.py` and
`analysis.py` one mutation at a time, such as flipping a comparison or deleting a statement.
It then checks that a test fails. The script first confirms the unmutated tests pass, and it
pins the test command to the current interpreter. Without that, a missing dependency would
make every mutant look "killed". cosmic-ray edits source files in place and restores them,
so commit your work first. The run writes `docs/mutation-score.json` and `mutation/report.txt`,
and CI uploads the report as an artifact. A partial local run (57 of 260 mutants) killed
37, about 65%. The 80% target is reported but does not fail CI until a full baseline exists.
Each mutant re-runs the selected tests, so a full local run takes over an hour on Windows.

## CRAP score

```bash
uv run pytest && uv run python scripts/quality_report.py --max-crap 30
```

CRAP = complexity² × (1 − coverage)³ + complexity, per function, from Radon and coverage.py.
It points at functions that are both complex and under-tested. Results are in
[quality-metrics.json](quality-metrics.json).

## MCP metadata lint

```bash
uv run review-helper-lint            # local definitions
uv run review-helper-lint --url https://host/mcp/ --publish
```

The linter checks titles, descriptions, annotations, schemas, app resource MIME type and CSP,
and the model-visible token budget. It is a local check, not Manufact's hosted checklist.

## Live providers

```bash
REVIEW_HELPER_LIVE=1 uv run pytest -m live --no-cov
```

These import merged public PRs from GitHub, GitLab, Bitbucket and Azure DevOps, without
tokens. They run weekly in CI and are skipped by default.
