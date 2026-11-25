"""Entry point: `uvicorn main:app --reload` locally, or `python main.py` (used by app.yaml)."""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from ia_backend.api import register_error_handlers, router
from ia_backend.config import Settings
from ia_backend.db import DatabricksClient
from ia_backend.service import InsightAcceleratorService

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
log = logging.getLogger(__name__)

# Built React dashboard (`npm run build` in Frontend/). Committed to the repo, so
# a deploy needs no Node build step.
FRONTEND_DIST = Path(__file__).resolve().parent.parent / "Frontend" / "dist"


class _Frontend(StaticFiles):
    """Serves the dashboard. Hashed files under assets/ may be cached; everything
    else (index.html) is revalidated so a redeploy never points at deleted bundles."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if Path(path).parts[:1] != ("assets",):
            response.headers["Cache-Control"] = "no-cache"
        return response


def _mount_frontend(app: FastAPI, dist: Path) -> None:
    if not (dist / "index.html").is_file():
        log.warning("No frontend build at %s; serving the API only.", dist)
        return
    # Mounted last, so /api/*, /docs and /openapi.json are matched first.
    app.mount("/", _Frontend(directory=dist, html=True), name="frontend")


def create_app(settings: Settings | None = None, frontend_dist: Path = FRONTEND_DIST) -> FastAPI:
    settings = settings or Settings.from_env()
    client = DatabricksClient(settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield
        client.close()

    app = FastAPI(title="LGMD Insight Accelerator API", version="1.0.0", lifespan=lifespan)
    app.state.service = InsightAcceleratorService(client, settings)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins,
                       allow_methods=["*"], allow_headers=["*"])
    app.include_router(router)
    register_error_handlers(app)
    _mount_frontend(app, frontend_dist)
    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("DATABRICKS_APP_PORT") or os.getenv("PORT") or 8000)
    uvicorn.run(app, host="0.0.0.0", port=port)
