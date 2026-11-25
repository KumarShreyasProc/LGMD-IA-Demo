"""Entry point: `uvicorn main:app --reload` locally, or `python main.py` (used by app.yaml)."""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from ia_backend.api import register_error_handlers, router
from ia_backend.config import Settings
from ia_backend.db import DatabricksClient
from ia_backend.service import InsightAcceleratorService

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))


def create_app(settings: Settings | None = None) -> FastAPI:
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
    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("DATABRICKS_APP_PORT") or os.getenv("PORT") or 8000)
    uvicorn.run(app, host="0.0.0.0", port=port)
