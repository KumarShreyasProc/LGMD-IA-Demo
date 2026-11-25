"""
Dashboard service: one method per kind of visual.

Framework-agnostic: the FastAPI routes in api.py call these methods, and a Dash
or Streamlit app can import and call them directly, e.g.

    service = InsightAcceleratorService(DatabricksClient(settings), settings)
    df = service.breakdown("enrolling_hcp_region").to_dataframe()
"""
from __future__ import annotations

import dataclasses
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Iterable, Mapping

from .config import Settings
from .db import QueryResult
from .query_builder import QueryBuilder, SqlQuery, merge_filters, quote_ident
from .semantic_model import DATE_BASES, DERIVED_SOURCE_COLUMNS, MODEL, SemanticModel

log = logging.getLogger(__name__)

Filters = Mapping[str, Any] | None

# ---- Dashboard defaults (edit to match your report pages) ------------------- #
KPI_MEASURES = [
    "new_patients_written", "new_patients_filled", "total_shipments",
    "pct_initiate_therapy", "pct_initiated_not_ft", "pct_initiate_sp", "pct_initiate_paid",
    "pct_initiate_paid_exclude_ft", "pct_initiate_sp_excludes_ft",
    "refresh_timestamp", "data_refresh_date",
]
CHART_MEASURES = [
    "new_patients_written", "new_patients_filled",
    "pct_initiate_therapy", "pct_initiated_not_ft", "pct_initiate_paid",
]
SLICERS = [
    "src_table", "prgrm_nm", "enrolling_hcp_area", "enrolling_hcp_region",
    "enrolling_hcp_territory", "enrollment_pyr_typ", "enrolling_hcp_specialty",
    "enrolling_hcp_segment", "enrolling_hcp_priority", "enrolling_hcp_trgt",
    "current_status", "enrollment_pharmacy",
]
PATIENT_COLUMNS = [
    "crx_ptnt_id", "src_table", "prgrm_nm", "enrollment_date", "enrolling_hcp_name",
    "enrolling_hcp_specialty", "enrolling_hcp_territory", "enrollment_pyr_nm",
    "enrollment_pyr_typ", "first_fill_date", "first_paid_fill_date", "current_status",
    "current_sub_status", "last_shipment_date", "total_shipments",
]
FUNNEL_STAGES = [
    ("Written", "new_patients_written"),
    ("Initiated therapy", "initiated_therapy_count"),
    ("Initiated non-free-trial", "initiated_not_ft_count"),
    ("Initiated paid", "initiated_paid_count"),
]


# A table loaded from text (e.g. a CSV upload) can store numbers and dates as strings,
# with the literal 'null' for missing values. Such columns are converted to the type the
# model expects, so the metric-view formulas (SUM, dates, IS NULL) behave as designed.
_TEXT_TYPES = {"string", "varchar", "char"}
_TEXT_FIXES = {
    "string": "NULLIF({col}, 'null')",
    "number": "TRY_CAST({col} AS DOUBLE)",
    "date": "TRY_CAST({col} AS DATE)",
    "timestamp": "TRY_CAST({col} AS TIMESTAMP)",
}


def _number(value: Any) -> float | None:
    return None if value is None else float(value)


class InsightAcceleratorService:
    def __init__(self, client, settings: Settings, model: SemanticModel = MODEL):
        self.client = client          # DatabricksClient (or anything with .query(sql, params))
        self.settings = settings
        self.model = model
        self.schema_info: dict | None = None
        self._builder: QueryBuilder | None = None
        self._lock = threading.Lock()

    # ---- source table ---------------------------------------------------- #
    @property
    def builder(self) -> QueryBuilder:
        if self._builder is None:
            with self._lock:
                if self._builder is None:
                    self._builder = QueryBuilder(self.model, self._resolve_source())
        return self._builder

    def _resolve_source(self) -> str:
        """Inspect the table once: type text-stored columns, and compute the 4
        calculated columns if it lacks them."""
        table = self.settings.quoted_source_table
        schema = self.client.query(f"SELECT * FROM {table} LIMIT 0", use_cache=False)
        columns = schema.columns
        existing = {c.lower() for c in columns}
        to_derive = {n: e for n, e in DERIVED_SOURCE_COLUMNS.items() if n.lower() not in existing}
        available = existing | {n.lower() for n in to_derive}
        missing = sorted({d.column for d in self.model.dimensions.values()
                          if d.column.lower() not in available})
        kinds = {d.column.lower(): d.kind for d in self.model.dimensions.values() if not d.derived}
        text_fixes = {c: _TEXT_FIXES[kinds[c.lower()]].format(col=quote_ident(c))
                      for c, t in zip(columns, schema.column_types)
                      if t in _TEXT_TYPES and c.lower() in kinds}
        retyped = sorted(c for c in text_fixes if kinds[c.lower()] != "string")
        self.schema_info = {
            "table": self.settings.source_table,
            "columns_found": len(columns),
            "computed_in_backend": sorted(to_derive),
            "text_columns_typed_in_backend": retyped,
            "missing_columns": missing,
        }
        if missing:
            log.warning("%s is missing columns used by the model: %s",
                        self.settings.source_table, ", ".join(missing))
        if retyped:
            log.warning("%s stores these columns as text; casting them in queries: %s",
                        self.settings.source_table, ", ".join(retyped))

        select_typed = None
        if text_fixes:
            names = ", ".join(quote_ident(c) for c in text_fixes)
            fixed = ", ".join(f"{expr} AS {quote_ident(c)}" for c, expr in text_fixes.items())
            select_typed = f"SELECT * EXCEPT ({names}), {fixed} FROM {table}"
        if to_derive:  # computed from the typed columns
            extra = ", ".join(f"{expr} AS {quote_ident(name)}" for name, expr in to_derive.items())
            inner = f"({select_typed}) AS typed" if select_typed else table
            return f"(SELECT *, {extra} FROM {inner}) AS source"
        return f"({select_typed}) AS source" if select_typed else f"{table} AS source"

    def _run(self, query: SqlQuery, **meta) -> QueryResult:
        result = self.client.query(query.sql, query.params)
        # copy so the cached object is never mutated
        return dataclasses.replace(
            result, fields=[self.model.field_meta(c) for c in result.columns], meta=meta)

    # ---- metadata / health ----------------------------------------------- #
    def meta(self) -> dict:
        return {
            **self.model.describe(),
            "source_table": self.settings.source_table,
            "schema": self.schema_info,
            "defaults": {"kpi_measures": KPI_MEASURES, "chart_measures": CHART_MEASURES,
                         "slicers": SLICERS, "patient_columns": PATIENT_COLUMNS},
        }

    def health_check(self) -> dict:
        self.client.query("SELECT 1 AS ok", use_cache=False)
        _ = self.builder  # forces the schema check
        return {"status": "ok", "schema": self.schema_info}

    # ---- visuals ------------------------------------------------------------ #
    def query(self, measures: Iterable[str] = (), dimensions: Iterable[str] = (),
              filters: Filters = None, order_by: Iterable[str] | None = None,
              limit: int | None = None) -> QueryResult:
        """Generic: any measures grouped by any dimensions (tables, matrices, custom charts)."""
        return self._run(self.builder.aggregate(measures, dimensions, filters, order_by, limit))

    def kpis(self, filters: Filters = None, measures: Iterable[str] | None = None) -> dict:
        """One row of headline numbers for the KPI cards."""
        result = self._run(self.builder.aggregate(measures or KPI_MEASURES, (), filters))
        return {"values": result.rows[0] if result.rows else {}, "fields": result.fields}

    def breakdown(self, dimension: str, measures: Iterable[str] | None = None,
                  filters: Filters = None, top_n: int | None = 25,
                  order_by: Iterable[str] | None = None) -> QueryResult:
        """Bar/table by one dimension (region, territory, payer type, specialty...)."""
        measures = list(measures or CHART_MEASURES)
        order = list(order_by or [f"-{measures[0]}"])
        query = self.builder.aggregate(measures, [dimension], filters, order, top_n)
        return self._run(query, dimension=self.model.dimension(dimension).name)

    def trend(self, date_basis: str = "enrollment", grain: str = "month",
              measures: Iterable[str] | None = None, filters: Filters = None,
              start: Any = None, end: Any = None) -> QueryResult:
        """Time series by enrollment / first fill / first paid ... date at week|month|quarter|year."""
        period = self.model.period_dimension(date_basis, grain)
        filters = merge_filters(filters, period.name, {"is_null": False})
        date_range = {k: v for k, v in (("gte", start), ("lte", end)) if v}
        if date_range:
            filters = merge_filters(filters, DATE_BASES[date_basis][0], date_range)
        query = self.builder.aggregate(measures or CHART_MEASURES, [period.name], filters,
                                       order_by=[period.name])
        return self._run(query, period_field=period.name, date_basis=date_basis, grain=grain)

    def funnel(self, filters: Filters = None) -> list[dict]:
        """Written -> initiated -> initiated non-FT -> initiated paid."""
        result = self._run(self.builder.aggregate([m for _, m in FUNNEL_STAGES], (), filters))
        row = result.rows[0] if result.rows else {}
        written = _number(row.get("new_patients_written")) or 0.0
        stages = []
        for label, measure in FUNNEL_STAGES:
            value = _number(row.get(measure))
            stages.append({"stage": label, "measure": measure, "value": value,
                           "pct_of_written": (value / written) if written and value is not None else None})
        return stages

    def patients(self, columns: Iterable[str] | None = None, filters: Filters = None,
                 order_by: Iterable[str] | None = None, limit: int = 100,
                 offset: int = 0) -> dict:
        """Patient-level detail table with paging."""
        page = self._run(self.builder.detail(
            list(columns or PATIENT_COLUMNS), filters,
            list(order_by or ["-enrollment_date", "crx_ptnt_id"]), limit, offset))
        count = self.builder.count(filters)
        total = self.client.query(count.sql, count.params).rows[0]["row_count"]
        return {**page.as_dict(), "total": int(total or 0), "limit": limit, "offset": offset}

    def filter_options(self, dimensions: Iterable[str] | None = None, filters: Filters = None,
                       limit: int = 500) -> dict[str, list]:
        """Values for slicer dropdowns. Each slicer respects the *other* active filters."""
        names = [self.model.dimension(d).name for d in (dimensions or SLICERS)]
        if not names:
            return {}
        builder = self.builder
        active = dict(filters or {})

        def load(name: str) -> tuple[str, list]:
            others = {k: v for k, v in active.items() if self.model.dimension(k).name != name}
            q = builder.distinct_values(name, others, limit)
            return name, [row["value"] for row in self.client.query(q.sql, q.params).rows]

        with ThreadPoolExecutor(max_workers=min(len(names), self.settings.pool_size)) as pool:
            return dict(pool.map(load, names))
