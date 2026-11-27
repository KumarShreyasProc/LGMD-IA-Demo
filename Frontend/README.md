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
| Charts | `POST /api/trend` (monthly series), `POST /api/query` (NBRx by status, enrollment source shares) and `POST /api/patients-on-drug` (patients on drug, discontinuation) |

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
- The Summary page shows the selection twice: a table (matrix) and a chart below it. Both always
  use the checked fields and measures; their personalize panels edit those same lists and save
  only the visual type and Columns. Charts put counts and percentages on separate charts (one
  axis each), and with Columns as the legend or for pie/donut show one chart per measure.
- "Personalize this visual" (the chart-with-pencil icon on the Summary visuals and on the
  charts that read `/api/query`) opens a side panel: visualization type, Rows, Columns and
  Values (on the Charts page from `/api/meta`). `src/visuals/` loads the data with one `/api/query` per grouping:
  rows + columns, rows only (row totals and matrix subtotals), columns only (column totals,
  top 25 matrix columns / 8 chart series) and no dimensions (grand total), so percentage
  totals are never summed or averaged. Personalizations are saved with the shared state
  (`visuals`); "Reset to default" removes one, and "Clear all filters" leaves them alone.
  Export CSV exports what the visual shows. The patients-on-drug charts and the Free Trial
  progression chart use their own endpoints or layout and are not personalizable.
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
