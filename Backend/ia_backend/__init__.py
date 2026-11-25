"""Insight Accelerator backend: the metric-view measures served from workspace.default.attruby_ia."""
from .config import Settings
from .db import DatabricksClient, QueryResult
from .semantic_model import MODEL
from .service import InsightAcceleratorService


def create_service(settings: Settings | None = None) -> InsightAcceleratorService:
    """Convenience for Dash/Streamlit/notebooks: service = create_service()."""
    settings = settings or Settings.from_env()
    return InsightAcceleratorService(DatabricksClient(settings), settings)


__all__ = ["Settings", "DatabricksClient", "QueryResult", "MODEL",
           "InsightAcceleratorService", "create_service"]
