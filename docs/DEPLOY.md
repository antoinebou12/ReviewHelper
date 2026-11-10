# Deploying Review Helper

One process serves the web app (`/`), the REST API (`/api`, `/docs`, `/redoc`) and the
Streamable HTTP MCP endpoint (`/mcp/`). Set `REVIEW_HELPER_ACCESS_TOKEN` on any deployment
that other people can reach. Clients then send `Authorization: Bearer <token>`.

## Docker

```bash
docker compose up --build
```

- **Image:** two stages. Node 22 builds the viewer, then Python 3.12 runs the app with uv-locked dependencies as a non-root user.
- **Data:** reviews are stored in SQLite at `/data/reviews.sqlite3`, on the `review-data` volume.
- **Port:** Compose binds to `127.0.0.1:8000`. Change the `ports` entry only after you set an access token.
- **Settings:** Compose reads `.env` when it exists. See [.env.example](../.env.example).

Without Compose:

```bash
docker build -t review-helper .
docker run --rm -p 127.0.0.1:8000:8000 -v review-data:/data review-helper
```

## Vercel

`pyproject.toml` sets `[tool.vercel] entrypoint = "review_helper.app:app"` and builds the viewer
with `npm ci && npm run build`. Vercel Functions keep no state between invocations: SQLite
lives in `/tmp`, and device sign-in (GitHub, Entra) is disabled. Use server tokens there.

## Manufact Cloud

[Manufact](https://manufact.com) hosts MCP servers from a GitHub repository. Its
[build runtimes](https://docs.manufact.com/dashboard/build-runtimes) detect Python from
`pyproject.toml` (uv) or use a committed Dockerfile. This repository works either way. The
Dockerfile is the simplest choice, because it also builds the viewer.

One-time setup, with your Manufact account:

1. In the Manufact dashboard, choose **Integrations → GitHub → Connect** and give the
   Manufact GitHub App access to this repository.
2. Sign in from the CLI: `npx mcp-use login`.
3. Deploy from the repository root:

   ```bash
   npx mcp-use deploy --name review-helper --dockerfile Dockerfile
   ```

4. In **Settings → Build & Runtime**, set the listening port to `8000`.
5. Add secrets in **Environment variables**: `REVIEW_HELPER_ACCESS_TOKEN`, provider tokens,
   and optional Jira settings. Redeploy for them to take effect.

Later pushes redeploy the same server. The CLI writes its link to `.manufact/project.json`,
which is ignored by git.

**MCP App domain.** MCP hosts want the app's origin declared. Review Helper uses
`MCP_APP_DOMAIN` if you set it. Otherwise it falls back to the origin of `MCP_URL`, the public
URL Manufact injects, so no extra setup is needed on Manufact.

**Publishing.** Before listing the server, run the local linter (`uv run review-helper-lint
--url https://<your-server>/mcp/ --publish`). Then run Manufact's hosted publish checks from
the dashboard. The local linter does not replace those checks.
