# Changelog

All notable changes to Review Helper are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-10

First public prototype.

### Added

- Feature sections: a pull request is split into behaviour-level sections that cut across
  UI, API, data and tests, instead of a flat file list.
- Hunk-level sections: one file can be shared by several features. Every hunk has exactly
  one owner, and each section shows only its own hunks and the line comments inside them.
- Reading order inside a section: data → service → API → client state → UI → tests.
- Diagrams that appear only when they have content: project topology, C4-style containers,
  use cases, sequence, class, data model (SQL and ORM) and a test map. Added, modified and
  deleted files are green, yellow and red, with symbols and labels.
- Nearby files: unchanged files the change imports, links to or is named after, with the
  reason shown on each card.
- Unified and side-by-side diffs, safe Markdown comments, collapsed bot comments.
- Importers for GitHub, GitLab, Bitbucket and Azure DevOps public URLs, with optional
  tokens, GitHub and Microsoft Entra device sign-in, and linked Jira issues.
- MCP server (Streamable HTTP and stdio) with tools, prompts, resources, a review skill and
  an MCP App that runs inside chat hosts, plus `/mcp-preview` to see it locally.
- REST API with OpenAPI, Swagger UI (`/docs`) and ReDoc (`/redoc`).
- Light and dark themes, keyboard navigation (`/`, `J`, `K`), compact chat layout.
- Docker image and Docker Compose file.
- Tests: unit and MCP protocol tests with an 85% coverage gate, Playwright end-to-end tests
  for the web app and MCP App, mutation testing of the review logic, CRAP scores, a local
  MCP metadata linter, and opt-in live tests against real public PRs on every provider.
- GitHub Actions CI and Renovate configuration.

### Fixed

- Azure DevOps public projects: PR iterations need sign-in, so changes are read by comparing
  the PR's latest commits.
- Bitbucket: the repository tree loads (page numbers are no longer sent to cursor APIs).
- GitLab: discussions that need a token are reported with their count.

[Unreleased]: https://github.com/antoinebou12/ReviewHelper/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/antoinebou12/ReviewHelper/releases/tag/v0.1.0
