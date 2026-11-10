# syntax=docker/dockerfile:1

# 1. Build the single-file viewer (web app and MCP App share it).
FROM node:22-slim AS ui
WORKDIR /app
COPY package.json package-lock.json tsconfig.json vite.config.ts index.html ./
RUN npm ci --no-audit --no-fund
COPY ui ./ui
RUN npm run build

# 2. Python runtime with locked dependencies.
FROM python:3.12-slim AS runtime
COPY --from=ghcr.io/astral-sh/uv:0.9.28 /uv /bin/uv
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    REVIEW_HELPER_DB_PATH=/data/reviews.sqlite3
WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project
COPY review_helper ./review_helper
COPY --from=ui /app/review_helper/static ./review_helper/static
RUN uv sync --frozen --no-dev --no-editable \
    && useradd --system --uid 10001 reviewer \
    && mkdir -p /data && chown reviewer /data
USER reviewer
EXPOSE 8000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
    CMD ["/app/.venv/bin/python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)"]
# Web app, REST API (/docs, /redoc) and Streamable HTTP MCP endpoint (/mcp) on one port.
CMD ["/app/.venv/bin/review-helper", "--host", "0.0.0.0", "--port", "8000"]
