# Insights Accelerator — React frontend for Databricks Apps

A React + TypeScript (Vite) version of the BridgeBio Insights Accelerator, with a small
Node/Express server so it runs as a **Databricks App**.

It runs on **sample data** out of the box (`USE_SAMPLE_DATA = true` in `src/data/api.ts`),
so you can deploy and click through it before any data work is done.

## What's inside

| Page | What it does |
|---|---|
| About | Purpose, data sources, and every measure with its definition (from `src/config/model.ts`) |
| Summary | Self-serve builder: Select Source → Fields → Measures → Filters → results table (+ CSV export) |
| Detailed Table View | Patient-level table with Dates / HCP / Payer / IDs / Flags filters, column chooser, paging, CSV export |
| Charts | Patient Access (4 charts), Demand Volume & Shipments, Persistence, Reported Adherence, Net Sales, Patient Status |

### Conditional visibility (built in)
- **Source drives everything:** fields and measures shown depend on the selected source
  (SP/HUB, 3PL, ATU Survey). Deselecting a source hides — and drops — its fields/measures.
- **Select Filters buttons** open the matching filter panel (Patient, HCP, Payer/Pharmacy, Program, Dates);
  clicking again closes it. Attribute filters only appear when SP/HUB is selected.
- **Results** only appear once at least one field and one measure are picked; the title shows
  "Measures by Fields | Filters Applied On: …".
- **Applied filters** show as removable chips with "Clear all filters".
- Detailed Table View: show/hide filters, choose columns, empty states when nothing matches.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
```

## Deploy to Databricks Apps (from GitHub)

1. Push this folder to your GitHub repo (keep `app.yaml` and `package.json` at the repo root, or point the app at this folder).
2. In Databricks: **Compute → Apps → Create app → Custom app**, then link the Git repository/folder.
   (Or use the CLI: `databricks apps deploy <app-name> --source-code-path <workspace-path>`.)
3. Deploy. Databricks installs the npm dependencies; `app.yaml` then runs `npm run build && npm run start`.
4. Share the app with users/groups (CAN_USE).

All build tools are listed under `dependencies` (not `devDependencies`) on purpose, so the build works during deployment.

## Connect real data (next step)

1. Build Unity Catalog views: patient-level SP/HUB table, a measure dictionary, and monthly aggregates for charts.
2. Add a SQL warehouse as an app resource and turn on **user authorization** (scope `sql`) so each user's
   Unity Catalog permissions apply. The user's token arrives in the `x-forwarded-access-token` header.
3. In `server.js`, add routes `/api/summary`, `/api/patients`, `/api/series/:id` that query the warehouse
   (e.g. with the `@databricks/sql` Node driver). **Build SQL only from the approved field/measure IDs in
   `src/config/model.ts` — never from raw user text.**
4. Set `USE_SAMPLE_DATA = false` in `src/data/api.ts`.

## Customise

- Add or rename a measure/field/filter: edit `src/config/model.ts` — the UI updates automatically.
- Colours and layout: `src/styles.css` (variables at the top).
- Measures marked "Existing Insights Accelerator" (Total shipments, % Initiated …) still need agreed definitions.
