"""FastAPI/OpenAPI surface and mounted Streamable HTTP MCP server."""

import hmac
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse

from . import store
from .analysis import apply_plan, section_detail
from .demo import demo_review
from .entra import LoginError, entra
from .mcp_server import mcp
from .models import ImportRequest, PlanRequest, Review, ReviewProgress
from .providers import TOKEN_ENV, ProviderClient, ProviderError, parse_url


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with mcp.session_manager.run():
        yield


app = FastAPI(
    title="Review Helper",
    version="0.1.0",
    lifespan=lifespan,
    description="Feature-based pull request review. Read-only provider imports, local review plans.",
)


@app.middleware("http")
async def access_control(request: Request, call_next):
    protected = request.url.path.startswith(("/api/", "/mcp"))
    key = os.getenv("REVIEW_HELPER_ACCESS_TOKEN")
    if protected and key:
        given = request.headers.get("authorization", "").removeprefix("Bearer ")
        if not hmac.compare_digest(given, key):
            return JSONResponse({"detail": "Enter the workspace access token in Settings."}, status_code=401)
    # Prevent cross-origin drive-by writes to a local workspace, including when auth is disabled.
    origin = request.headers.get("origin")
    if protected and origin and origin != str(request.base_url).rstrip("/"):
        return JSONResponse({"detail": "Cross-origin requests are not allowed."}, status_code=403)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    if protected:
        response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(KeyError)
async def missing(request: Request, exc: KeyError):
    return JSONResponse({"detail": "Review or section not found."}, status_code=404)


@app.exception_handler(ProviderError)
async def provider_error(request: Request, exc: ProviderError):
    return JSONResponse({"detail": str(exc)}, status_code=400)


@app.exception_handler(LoginError)
async def login_error(request: Request, exc: LoginError):
    return JSONResponse({"detail": str(exc)}, status_code=400)


@app.get("/health", tags=["System"])
def health() -> dict:
    return {"status": "ok", "version": "0.1.0"}


@app.get("/api/config", tags=["System"])
def config() -> dict:
    return {
        "providers": {name: bool(os.getenv(env)) for name, env in TOKEN_ENV.items()},
        "auth_enabled": bool(os.getenv("REVIEW_HELPER_ACCESS_TOKEN")),
        "mode": "single-user",
        "azure": entra.status(),
    }


@app.post("/api/auth/azure/start", tags=["Connections"])
async def azure_start() -> dict:
    return await entra.start()


@app.post("/api/auth/azure/poll/{login_id}", tags=["Connections"])
async def azure_poll(login_id: str) -> dict:
    return await entra.poll(login_id)


@app.post("/api/auth/azure/logout", tags=["Connections"])
def azure_logout() -> dict:
    return entra.logout()


@app.get("/api/demo", response_model=Review, tags=["Reviews"])
def demo() -> Review:
    return demo_review()


@app.post("/api/reviews", response_model=Review, tags=["Reviews"])
async def import_review(body: ImportRequest) -> Review:
    return store.save(await ProviderClient(parse_url(body.url), body.token).load())


@app.get("/api/reviews/{review_id}", response_model=Review, tags=["Reviews"])
def get_review(review_id: str) -> Review:
    return store.get(review_id)


@app.get("/api/reviews/{review_id}/sections/{section_id}", tags=["Reviews"])
def get_section(review_id: str, section_id: str) -> dict:
    return section_detail(store.get(review_id), section_id)


@app.put("/api/reviews/{review_id}/plan", response_model=Review, tags=["Reviews"])
def update_plan(review_id: str, body: PlanRequest) -> Review:
    review = store.get(review_id)
    if body.expected_head != review.head_sha:
        raise HTTPException(409, "Snapshot head changed. Reload before editing the plan.")
    try:
        result = store.save(apply_plan(review, body))
        store.progress(review_id, [])
        return result
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.get("/api/reviews/{review_id}/progress", response_model=ReviewProgress, tags=["Reviews"])
def get_progress(review_id: str) -> ReviewProgress:
    return ReviewProgress(sections=store.progress(review_id))


@app.put("/api/reviews/{review_id}/progress", response_model=ReviewProgress, tags=["Reviews"])
def put_progress(review_id: str, body: ReviewProgress) -> ReviewProgress:
    try:
        return ReviewProgress(sections=store.progress(review_id, body.sections))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
def index():
    path = Path(__file__).parent / "static" / "index.html"
    if not path.exists():
        return HTMLResponse(
            "<h1>Review Helper</h1><p>Run npm ci and npm run build to build the viewer.</p>", 503
        )
    return HTMLResponse(path.read_text(encoding="utf-8"))


app.mount("/mcp", mcp.streamable_http_app())
