"""REST API for the dashboard frontend. Interactive docs at /docs once running."""
from __future__ import annotations

import datetime as dt
from typing import Any, Literal

from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .errors import ConfigError, DatabaseError, QueryError
from .service import InsightAcceleratorService

router = APIRouter(prefix="/api", tags=["Insight Accelerator"])

FILTER_HELP = (
    'Keyed by dimension name, e.g. {"enrolling_hcp_region": ["East", "West"], '
    '"enrollment_date": {"between": ["2025-01-01", "2025-06-30"]}, "prgrm_nm": {"not_in": ["Free Trial"]}}. '
    "Operators: eq ne gt gte lt lte in not_in between is_null contains. Use null for (Blank)."
)


def _service(request: Request) -> InsightAcceleratorService:
    return request.app.state.service


class Filtered(BaseModel):
    filters: dict[str, Any] = Field(default_factory=dict, description=FILTER_HELP)


class QueryRequest(Filtered):
    measures: list[str] = Field(default_factory=list)
    dimensions: list[str] = Field(default_factory=list)
    order_by: list[str] = Field(default_factory=list, description='"-name" or "name desc" for descending')
    limit: int | None = Field(None, ge=1)


class KpiRequest(Filtered):
    measures: list[str] | None = None


class BreakdownRequest(Filtered):
    dimension: str
    measures: list[str] | None = None
    order_by: list[str] | None = None
    top_n: int | None = Field(25, ge=1)


class TrendRequest(Filtered):
    date_basis: Literal["enrollment", "first_fill", "first_not_ft", "first_paid", "status_change"] = "enrollment"
    grain: Literal["week", "month", "quarter", "year"] = "month"
    measures: list[str] | None = None
    start: dt.date | None = None
    end: dt.date | None = None


class PatientsRequest(Filtered):
    columns: list[str] | None = None
    order_by: list[str] | None = None
    limit: int = Field(100, ge=1, le=10_000)
    offset: int = Field(0, ge=0)


class FilterOptionsRequest(Filtered):
    dimensions: list[str] | None = None
    limit: int = Field(500, ge=1, le=10_000)


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/health/db")
def health_db(request: Request):
    """Checks the warehouse connection and that the source table has the expected columns."""
    return _service(request).health_check()


@router.get("/meta")
def meta(request: Request):
    """All dimensions, measures (with formats) and dashboard defaults."""
    return _service(request).meta()


@router.post("/query")
def query(body: QueryRequest, request: Request):
    return _service(request).query(body.measures, body.dimensions, body.filters,
                                   body.order_by, body.limit).as_dict()


@router.post("/kpis")
def kpis(body: KpiRequest, request: Request):
    return _service(request).kpis(body.filters, body.measures)


@router.post("/breakdown")
def breakdown(body: BreakdownRequest, request: Request):
    return _service(request).breakdown(body.dimension, body.measures, body.filters,
                                       body.top_n, body.order_by).as_dict()


@router.post("/trend")
def trend(body: TrendRequest, request: Request):
    return _service(request).trend(body.date_basis, body.grain, body.measures, body.filters,
                                   body.start, body.end).as_dict()


@router.post("/funnel")
def funnel(body: Filtered, request: Request):
    return {"stages": _service(request).funnel(body.filters)}


@router.post("/patients")
def patients(body: PatientsRequest, request: Request):
    return _service(request).patients(body.columns, body.filters, body.order_by,
                                      body.limit, body.offset)


@router.post("/filter-options")
def filter_options(body: FilterOptionsRequest, request: Request):
    return {"options": _service(request).filter_options(body.dimensions, body.filters, body.limit)}


@router.post("/cache/clear")
def clear_cache(request: Request):
    """Call after the table is refreshed to drop cached results immediately."""
    client = _service(request).client
    if hasattr(client, "cache"):
        client.cache.clear()
    return {"status": "cleared"}


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(QueryError)
    async def _query_error(_: Request, exc: QueryError):
        return JSONResponse(status_code=400, content={"error": "invalid_request", "detail": str(exc)})

    @app.exception_handler(DatabaseError)
    async def _database_error(_: Request, exc: DatabaseError):
        return JSONResponse(status_code=502, content={"error": "databricks_error", "detail": str(exc)})

    @app.exception_handler(ConfigError)
    async def _config_error(_: Request, exc: ConfigError):
        return JSONResponse(status_code=500, content={"error": "configuration", "detail": str(exc)})
