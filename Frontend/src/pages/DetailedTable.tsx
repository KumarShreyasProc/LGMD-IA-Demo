import { useState } from 'react';
import { DATE_FILTERS, DETAIL_FILTER_GROUPS } from '../config/model';
import { api, byName, formatValue, useApi, useDebounced, useFilterOptions, type Value } from '../data/api';
import { useFilters, pageFilters } from '../state/filters';
import { AppliedFilters } from '../components/AppliedFilters';
import { MultiSelect } from '../components/MultiSelect';
import { DateRange } from '../components/DateRange';
import { DataTable, downloadCsv } from '../components/DataTable';
import { Panel } from '../components/Panel';

// Patient-level columns (backend dimension → header shown in the Power BI page).
const COLUMNS: { id: string; label: string }[] = [
  { id: 'src_table', label: 'Source' },
  { id: 'new_ptnt_written', label: 'New Patients Written' },
  { id: 'new_ptnt_filled', label: 'New Patients Filled' },
  { id: 'crx_ptnt_id', label: 'crx_ptnt_id' },
  { id: 'ptnt_gndr', label: 'Patient Gender' },
  { id: 'ptnt_yob', label: 'Patient Year of Birth' },
  { id: 'ptnt_st', label: 'Patient State' },
  { id: 'ltst_sp_ptnt_id', label: 'Latest_SP_ptnt_id' },
  { id: 'previous_targeted_therapy', label: 'previous_targeted_therapy' },
  { id: 'current_status', label: 'current_status' },
  { id: 'initiated_therapy', label: 'initiated_therapy' },
  { id: 'initiated_paid_therapy', label: 'initiated_paid_therapy' },
  { id: 'first_fill_shipment_type', label: 'first_fill_shipment_type' },
  { id: 'enrolling_hcp_territory', label: 'enrolling_hcp_territory' },
];
const COLUMN_IDS = COLUMNS.map((c) => c.id);
const DEFAULT_COLUMNS = COLUMN_IDS.slice(0, 10);
const columnLabel = (id: string) => COLUMNS.find((c) => c.id === id)?.label ?? id;

const SLICERS = DETAIL_FILTER_GROUPS.flatMap((g) => g.filters);

// Total row: backend measure for each summable column.
const TOTALS: Record<string, string> = { new_ptnt_written: 'new_patients_written', new_ptnt_filled: 'new_patients_filled' };
const ROW_LIMIT = 10_000; // backend maximum per request

export function DetailedTable() {
  const [showFilters, setShowFilters] = useState(true);
  const [showColumns, setShowColumns] = useState(false);
  const [columns, setColumns] = useState<string[]>(DEFAULT_COLUMNS);
  const { state, update, setSelection, setDate } = useFilters();
  const { selections, dates, patientId } = state;

  // Shared filters this page has slicers for; the ID search is debounced so typing doesn't query per key.
  const idSearch = useDebounced(patientId);
  const { filters, applied, notApplied } = pageFilters({ ...state, patientId: idSearch }, 'detail');
  const key = JSON.stringify(filters);
  const patients = useApi(key, () => api.patients({ columns: COLUMN_IDS, filters, limit: ROW_LIMIT }));
  const totals = useApi(key, () => api.kpis(Object.values(TOTALS), filters));
  const options = useFilterOptions(SLICERS, filters);

  const meta = byName(patients.data?.fields);
  const rows = patients.data?.rows ?? [];
  const tableRows = rows.map((r) => columns.map((c) => r[c] ?? null));
  const format = (v: Value, i: number) => formatValue(v, meta[columns[i]]);
  const totalMeta = byName(totals.data?.fields);
  const total = columns.map((c, i) =>
    i === 0 ? 'Total' : TOTALS[c] && totals.data ? formatValue(totals.data.values[TOTALS[c]], totalMeta[TOTALS[c]]) : '');
  const headers = columns.map(columnLabel);
  const activeCount = applied.length;
  const truncated = patients.data && patients.data.total > rows.length;

  return (
    <div className="page detail">
      <div className="toolbar">
        <button type="button" className="filter-btn" aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}>
          {showFilters ? 'Hide filters' : `Show filters${activeCount ? ` (${activeCount} applied)` : ''}`}
        </button>
        <button type="button" className="filter-btn" aria-expanded={showColumns} onClick={() => setShowColumns(!showColumns)}>
          Choose columns
        </button>
        <span className="spacer" />
        <button type="button" className="export" disabled={!rows.length}
          onClick={() => downloadCsv('patient-detail.csv', headers, tableRows.map((r) => r.map(format)))}>Export CSV</button>
      </div>

      {showColumns && (
        <Panel title="Columns" className="columns-panel">
          <div className="column-grid">
            {COLUMNS.map((c) => (
              <label key={c.id} className="check">
                <input type="checkbox" checked={columns.includes(c.id)}
                  onChange={() => setColumns(columns.includes(c.id) ? columns.filter((x) => x !== c.id) : COLUMN_IDS.filter((x) => x === c.id || columns.includes(x)))} />
                {c.label}
              </label>
            ))}
          </div>
        </Panel>
      )}

      {showFilters && (
        <div className="detail-filters">
          <Panel title="Dates" className="span-2">
            <div className="filter-grid">
              {DATE_FILTERS.map((d) => (
                <DateRange key={d.id} label={d.label} value={dates[d.id] ?? { from: '', to: '' }} onChange={(r) => setDate(d.id, r)} />
              ))}
            </div>
          </Panel>
          {DETAIL_FILTER_GROUPS.map((g) => (
            <Panel key={g.title} title={g.title}>
              <div className="filter-grid">
                {g.filters.map((id) => (
                  <MultiSelect key={id} label={id} options={options.data?.[id] ?? []} loading={options.loading}
                    value={selections[id] ?? []} onChange={(v) => setSelection(id, v)} />
                ))}
              </div>
            </Panel>
          ))}
          <Panel title="IDs">
            <label className="slicer">
              <span className="slicer-label">crx_ptnt_id</span>
              <input className="search" type="search" placeholder="Search patient ID" value={patientId} onChange={(e) => update({ patientId: e.target.value })} />
            </label>
          </Panel>
          {options.error && <p className="error span-2">Couldn't load filter values: {options.error}</p>}
        </div>
      )}

      <AppliedFilters applied={applied} notApplied={notApplied} />

      {columns.length === 0 ? (
        <section className="empty"><p><strong>No columns selected.</strong> Use “Choose columns” to add some.</p></section>
      ) : patients.loading ? (
        <p className="muted pad">Loading patients…</p>
      ) : patients.error ? (
        <p className="error pad">Couldn't load patients: {patients.error}</p>
      ) : rows.length === 0 ? (
        <section className="empty"><p><strong>No patients match these filters.</strong> Remove a filter to see results.</p></section>
      ) : (
        <>
          <DataTable columns={headers} rows={tableRows} format={format} total={total} numericFrom={99} pageSize={showFilters ? 8 : 18} />
          {truncated && (
            <p className="muted">
              Showing the first {rows.length.toLocaleString()} of {patients.data!.total.toLocaleString()} patients. Add filters to narrow the list (Export CSV includes the rows shown).
            </p>
          )}
          {totals.error && <p className="error">Couldn't load totals: {totals.error}</p>}
        </>
      )}
    </div>
  );
}
