# LGMD Insight Accelerator – Backend

Python backend that serves the Insight Accelerator dashboard from
`workspace.default.attruby_ia`, using the same dimensions and measures as the
Databricks metric view (originally migrated from `Insight Accelerator.pbit`).
It exposes a REST API (FastAPI) and can also be imported directly by a Dash,
Streamlit or notebook frontend.

## Layout

```
Backend/
├── main.py                  FastAPI app (uvicorn main:app)
├── app.yaml                 Databricks Apps config (optional)
├── requirements.txt
├── .env.example             local settings template
├── ia_backend/
│   ├── semantic_model.py    dimensions + measures ported from the metric view
│   ├── query_builder.py     whitelisted, parameterized SQL generation + filters
│   ├── service.py           KPIs, breakdowns, trends, funnel, patient table, slicers
│   ├── db.py                Databricks SQL connection pool + result cache
│   ├── api.py               REST routes
│   ├── config.py            settings from env vars
│   └── errors.py
└── tests/test_backend.py    offline tests (SQLite) – checks every measure's math
```

## Quick start (local)

```bash
cd Backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # fill in host, HTTP path and token from your SQL warehouse
uvicorn main:app --reload
```

Open http://localhost:8000/docs for interactive API docs, and hit
`GET /api/health/db` first: it checks the warehouse connection and reports any
columns the model expects that `attruby_ia` doesn't have.

Run the tests (no Databricks needed): `python tests/test_backend.py` or `pytest tests`.

## Measures

Measures keep the metric view's formulas; the API uses snake_case keys, but the
original names are accepted too (e.g. `"%_Initiate_Paid"`).

| Metric view name | API key | Formula | Format |
|---|---|---|---|
| new patients filled | `new_patients_filled` | SUM(new_ptnt_filled) | number |
| total shipments | `total_shipments` | SUM(total_shipments) | number |
| new patients written | `new_patients_written` | SUM(new_ptnt_written) | number |
| % Initiated_not_FT | `pct_initiated_not_ft` | initiated_not_free_trial_therapy / written | % (0 dp) |
| %_Initiate_Paid | `pct_initiate_paid` | initiated_paid_therapy / written | % (1 dp) |
| %_Initiate_SP | `pct_initiate_sp` | initiated_not_free_trial_therapy / written | % (1 dp) |
| %_Initiate_Therapy | `pct_initiate_therapy` | initiated_therapy / written | % (1 dp) |
| %_Initiate_Paid_Exclude_FT | `pct_initiate_paid_exclude_ft` | paid / written, program not blank and LOWER ≠ 'free trial' | % (1 dp) |
| %_Initiate_SP_Excludes_FT | `pct_initiate_sp_excludes_ft` | not-FT / written, program not blank and LOWER(TRIM) ≠ 'free trial' | % (1 dp) |
| Refresh Date | `refresh_timestamp` | CURRENT_TIMESTAMP() | timestamp |

All ratios return `null` when written = 0, like the metric view. Added for the
app (not in the metric view): `initiated_therapy_count`, `initiated_not_ft_count`,
`initiated_paid_count` (funnel stages) and `data_refresh_date` = MAX(refresh_date).

Ratios are returned as fractions (0.734); format them with the `format` and
`decimals` in each response's `fields`.

## Endpoints

All POST bodies accept `filters` (see below).

| Endpoint | Use for | Body example |
|---|---|---|
| `GET /api/meta` | dimension/measure lists, formats, default slicers | – |
| `POST /api/kpis` | KPI cards | `{"filters": {...}}` |
| `POST /api/breakdown` | bar charts / tables by one dimension | `{"dimension": "enrolling_hcp_region", "top_n": 20}` |
| `POST /api/trend` | time series | `{"date_basis": "enrollment", "grain": "month", "start": "2025-01-01"}` |
| `POST /api/funnel` | written → initiated → non-FT → paid | `{"filters": {...}}` |
| `POST /api/patients` | patient detail table (paged) | `{"limit": 100, "offset": 0}` |
| `POST /api/filter-options` | slicer dropdown values (cascading) | `{"dimensions": ["prgrm_nm", "enrolling_hcp_area"]}` |
| `POST /api/query` | anything else (matrix, custom chart) | `{"measures": [...], "dimensions": [...], "order_by": ["-new_patients_written"]}` |
| `POST /api/cache/clear` | drop cached results after a data refresh | – |

`date_basis`: `enrollment`, `first_fill`, `first_not_ft`, `first_paid`,
`status_change`. `grain`: `week` (uses the table's week-ending columns, so weeks
match Power BI), `month`, `quarter`, `year`.

### Filters

Keyed by dimension name; every endpoint uses the same format:

```json
{
  "filters": {
    "enrolling_hcp_region": ["East", "West"],
    "prgrm_nm": {"not_in": ["Free Trial"]},
    "enrollment_date": {"between": ["2025-01-01", "2025-06-30"]},
    "enrollment_pyr_typ": ["Commercial", null],
    "first_fill_date": {"is_null": false},
    "enrolling_hcp_name": {"contains": "smith"}
  }
}
```

A list means IN, a single value means equals, and `null` means (Blank).
Operators: `eq ne gt gte lt lte in not_in between is_null contains`. Like a
Power BI "exclude" selection, `not_in` keeps blank rows unless `null` is in the list.

The Power BI measures `Chart Title`, `Filters_In_Use` and `DateFilters_In_Use`
were skipped in the metric view because they read slicer state. The frontend
already knows its active filters, so build those labels there.

## Using it from Dash / Streamlit (no HTTP)

```python
from ia_backend import create_service

service = create_service()                       # reads .env / environment
kpis = service.kpis({"src_table": ["SP", "HUB"]})["values"]
by_region = service.breakdown("enrolling_hcp_region").to_dataframe()
trend = service.trend("first_fill", "month").to_dataframe()
```

## Deploying as a Databricks App

1. Create an app with its source pointed at this `Backend` folder (from the Git folder).
2. Add a SQL warehouse resource with key `sql-warehouse` (permission: Can use).
3. Grant the app's service principal `USE CATALOG` on `workspace`, `USE SCHEMA`
   on `workspace.default` and `SELECT` on `workspace.default.attruby_ia`.

`app.yaml` starts the API; host and credentials are injected automatically,
so no token is needed.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `DATABRICKS_SERVER_HOSTNAME` / `DATABRICKS_HOST` | – | warehouse host |
| `DATABRICKS_HTTP_PATH` / `DATABRICKS_WAREHOUSE_ID` | – | one of the two |
| `DATABRICKS_TOKEN` | – | if empty, Databricks SDK auth is used |
| `IA_SOURCE_TABLE` | `workspace.default.attruby_ia` | |
| `IA_CACHE_TTL_SECONDS` | 300 | 0 disables caching |
| `IA_POOL_SIZE` | 4 | warehouse connections kept open |
| `IA_CORS_ORIGINS` | `*` | comma-separated frontend URLs |

## Things to verify against the native dashboard

- **Calculated columns.** The metric view's source view materialized four DAX
  columns (`SP_Start_60d_threshold`, `SP_Start_60d_include_rule`,
  `EnrollmentQuarterStartDate`, `FFQuarterStartDate`). If `attruby_ia` has them
  they're used as-is; otherwise the backend computes them
  (`ia_backend/semantic_model.py`, `DERIVED_SOURCE_COLUMNS`). The threshold is
  computed as days from enrollment to today minus 1; if the DAX used
  `refresh_date` instead of today, change it there.
- **Duplicate formulas.** `% Initiated_not_FT` and `%_Initiate_SP` are the same
  formula in the metric view (only the decimals differ), so they return the same value.
- **Exclude-FT difference.** `%_Initiate_Paid_Exclude_FT` compares `LOWER(prgrm_nm)`,
  `%_Initiate_SP_Excludes_FT` compares `LOWER(TRIM(prgrm_nm))`, preserved as in the metric view.
- **Default slicers, KPI list and patient-table columns** are in the top of
  `ia_backend/service.py`; adjust them to match your report pages.
