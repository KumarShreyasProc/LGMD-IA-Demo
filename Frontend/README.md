# Insights Accelerator — React frontend

React + TypeScript (Vite) dashboard for the BridgeBio Insights Accelerator. It reads all
data from the FastAPI backend in `../Backend` through relative `/api/...` URLs, and the
backend serves the built app at the root URL of the Databricks App.

## What's inside

| Page | Data |
|---|---|
| About | Measure definitions from `GET /api/meta`; planned measures are marked "Not available yet" |
| Summary | Self-serve builder shown as a drill-down matrix: one `POST /api/query` per hierarchy level (subtotals) + `POST /api/kpis` (Total row); slicers from `POST /api/filter-options` |
| Detailed Table View | `POST /api/patients` (up to 10,000 rows) + `POST /api/kpis` (totals); slicers from `/api/filter-options` |
| Charts | `POST /api/trend` (monthly series) and `POST /api/query` (NBRx by status) |

- `src/config/model.ts` maps the UI's fields, measures and filters to backend names.
  Items with `live: false` have no backend data yet and are shown as "Not available yet".
- `src/data/api.ts` is the only place that calls the backend. Numbers are formatted with
  the `fields` metadata in each response (percentages arrive as fractions).
- `src/state/filters.tsx` holds the filters, source, fields and measures for all pages
  (like synced slicers) and saves them in localStorage. Saved data is validated on load;
  unknown fields or filters fall back to defaults, and slicer values that no longer occur
  in the data are dropped. Each page applies only the filters it has slicers for
  (`PAGE_FILTERS` in `model.ts`) and lists the others as "Saved, not used on this page".
  "Clear all filters" in the sidebar resets everything to the defaults.
- The chart/table titles and "Filters Applied On" labels (Power BI `Chart Title`,
  `Filters_In_Use`, `DateFilters_In_Use`) are built from that shared state.

## Deployment: the build is committed

`dist/` is committed. Databricks deploys the repo root, where `app.yaml` runs
`python Backend/main.py`, and `Backend/main.py` serves `Frontend/dist`. No Node build
runs during deployment.

**After any change in `src/`, rebuild and commit `dist/`:**

```bash
cd Frontend
npm ci
npm run build      # type-checks, then writes dist/
git add dist
```

## Local development

```bash
cd Backend && uvicorn main:app --reload    # API on :8000 (needs Backend/.env)
cd Frontend && npm ci && npm run dev       # http://localhost:5173, /api proxied to :8000
```

Behind a TLS-inspecting corporate proxy, run npm with `NODE_OPTIONS=--use-system-ca`
so Node trusts the Windows certificate store.
