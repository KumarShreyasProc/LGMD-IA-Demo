import { useMemo, useState } from 'react';
import { DATE_FILTERS, FIELDS, FILTER_GROUPS, MEASURES, SOURCES, fieldLabel, filterLabel, measureLabel, type SourceId } from '../config/model';
import {
  api, byName, formatValue, toApiFilters, useApi, useFilterOptions,
  type DateRange as Range, type DateRanges, type Selections, type Value,
} from '../data/api';
import { MultiSelect } from '../components/MultiSelect';
import { DateRange } from '../components/DateRange';
import { DataTable, downloadCsv } from '../components/DataTable';

const EMPTY_RANGE: Range = { from: '', to: '' };
const ROW_LIMIT = 5000;

export function Summary() {
  const [sources, setSources] = useState<SourceId[]>(['sphub']);
  const [fields, setFields] = useState<string[]>(['enrolling_hcp_territory']);
  const [measures, setMeasures] = useState<string[]>(['new_patients_filled']);
  const [fieldSearch, setFieldSearch] = useState('');
  const [activeGroup, setActiveGroup] = useState<string | null>('patient');
  const [selections, setSelections] = useState<Selections>({});
  const [dates, setDates] = useState<DateRanges>({});

  // ── Conditional visibility: what can be picked depends on the selected sources ──
  const visibleFields = useMemo(
    () => FIELDS.filter((f) => f.sources.some((s) => sources.includes(s)) && f.label.toLowerCase().includes(fieldSearch.toLowerCase())),
    [sources, fieldSearch],
  );
  const visibleMeasures = useMemo(() => MEASURES.filter((m) => sources.includes(m.source)), [sources]);
  const patientFiltersAvailable = sources.includes('sphub');

  // Only selections that are visible for the current sources and served by the backend are queried.
  const activeFields = fields.filter((id) => {
    const f = FIELDS.find((x) => x.id === id);
    return f?.live && f.sources.some((s) => sources.includes(s));
  });
  const activeMeasures = measures.filter((id) => visibleMeasures.some((m) => m.id === id && m.live));
  const ready = activeFields.length > 0 && activeMeasures.length > 0;

  const filters = toApiFilters(selections, dates);
  const appliedFilters = Object.entries(selections).filter(([, v]) => v.length > 0);
  const appliedDates = Object.entries(dates).filter(([, r]) => r.from || r.to);

  const tableRequest = { measures: activeMeasures, dimensions: activeFields, filters, order_by: [`-${activeMeasures[0]}`], limit: ROW_LIMIT };
  const key = ready ? JSON.stringify(tableRequest) : null;
  const table = useApi(key, () => api.query(tableRequest));
  const totals = useApi(key, () => api.kpis(activeMeasures, filters)); // ratio totals need the backend, not a sum of rows

  const group = FILTER_GROUPS.find((g) => g.id === activeGroup);
  const options = useFilterOptions(patientFiltersAvailable && group ? group.filters.map((f) => f.id) : [], filters);

  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const setSelection = (id: string, v: Value[]) => setSelections({ ...selections, [id]: v });

  // Replaces the Power BI "Chart Title" / "Filters_In_Use" / "DateFilters_In_Use" measures.
  const title = ready
    ? `${activeMeasures.map(measureLabel).join(', ')} by ${activeFields.map(fieldLabel).join(', ')} | Filters Applied On: ${
        [...appliedFilters, ...appliedDates].map(([k]) => filterLabel(k)).join('; ') || 'none'}`
    : '';

  const names = [...activeFields, ...activeMeasures];
  const columns = [...activeFields.map(fieldLabel), ...activeMeasures.map(measureLabel)];
  const meta = byName(table.data?.fields);
  const rows = (table.data?.rows ?? []).map((r) => names.map((n) => r[n] ?? null));
  const format = (v: Value, i: number) => formatValue(v, meta[names[i]]);
  const totalMeta = byName(totals.data?.fields);
  const totalRow = totals.data
    ? [...activeFields.map((_, i) => (i === 0 ? 'Total' : '')), ...activeMeasures.map((m) => formatValue(totals.data!.values[m], totalMeta[m]))]
    : undefined;

  return (
    <div className="page summary">
      <div className="source-row">
        <MultiSelect
          label="Select Source"
          options={SOURCES.map((s) => s.label)}
          value={SOURCES.filter((s) => sources.includes(s.id)).map((s) => s.label)}
          onChange={(labels) => setSources(SOURCES.filter((s) => labels.includes(s.label)).map((s) => s.id))}
        />
        <p className="hint">Fields, measures and filters below change with the selected source. 3PL and ATU Survey data are not connected yet.</p>
      </div>

      <div className="builder">
        <section className="builder-box">
          <h3 className="box-title">Select Fields</h3>
          <input className="search" type="search" placeholder="Search fields" aria-label="Search fields" value={fieldSearch} onChange={(e) => setFieldSearch(e.target.value)} />
          <div className="check-list">
            {visibleFields.length === 0 && <p className="muted">No fields for this source.</p>}
            {visibleFields.map((f) => (
              <label key={f.id} className={`check ${f.live ? '' : 'off'}`}>
                <input type="checkbox" disabled={!f.live} checked={f.live && fields.includes(f.id)} onChange={() => toggle(fields, setFields, f.id)} />
                {f.label}{!f.live && <span className="tag">not available yet</span>}
              </label>
            ))}
          </div>
        </section>

        <section className="builder-box">
          <h3 className="box-title">Select Measures</h3>
          <div className="check-list">
            {visibleMeasures.length === 0 && <p className="muted">Select a source to see measures.</p>}
            {visibleMeasures.map((m) => (
              <label key={m.id} className={`check ${m.live ? '' : 'off'}`} title={m.definition}>
                <input type="checkbox" disabled={!m.live} checked={m.live && measures.includes(m.id)} onChange={() => toggle(measures, setMeasures, m.id)} />
                {m.label}{!m.live && <span className="tag">not available yet</span>}
              </label>
            ))}
          </div>
        </section>

        <section className="builder-box">
          <h3 className="box-title">Select Filters</h3>
          {patientFiltersAvailable ? (
            <div className="filter-buttons">
              {FILTER_GROUPS.map((g) => (
                <button key={g.id} type="button" className={`filter-btn ${activeGroup === g.id ? 'on' : ''}`} aria-pressed={activeGroup === g.id}
                  onClick={() => setActiveGroup(activeGroup === g.id ? null : g.id)}>
                  {g.label}
                </button>
              ))}
            </div>
          ) : (
            <p className="muted pad">Attribute filters apply to SP/HUB data. Select SP/HUB as a source to use them.</p>
          )}
        </section>

        {patientFiltersAvailable && group && (
          <section className="builder-box wide">
            <h3 className="box-title">Apply {group.label === 'Dates' ? 'Date' : group.label.replace(' Attributes', '')} Filters</h3>
            <div className="filter-grid">
              {group.id === 'dates'
                ? DATE_FILTERS.map((d) => (
                    <DateRange key={d.id} label={d.label} value={dates[d.id] ?? EMPTY_RANGE} onChange={(r) => setDates({ ...dates, [d.id]: r })} />
                  ))
                : group.filters.map((f) => (
                    <MultiSelect key={f.id} label={f.label} options={options.data?.[f.id] ?? []} loading={options.loading}
                      value={selections[f.id] ?? []} onChange={(v) => setSelection(f.id, v)} />
                  ))}
            </div>
            {options.error && <p className="error pad">Couldn't load filter values: {options.error}</p>}
          </section>
        )}
      </div>

      {(appliedFilters.length > 0 || appliedDates.length > 0) && (
        <div className="chips" aria-label="Applied filters">
          {appliedFilters.map(([k, v]) => (
            <button key={k} type="button" className="chip" onClick={() => setSelection(k, [])} aria-label={`Remove filter ${filterLabel(k)}`}>
              {filterLabel(k)}: {v.map((x) => formatValue(x)).join(', ')} ✕
            </button>
          ))}
          {appliedDates.map(([k, r]) => (
            <button key={k} type="button" className="chip" onClick={() => setDates({ ...dates, [k]: EMPTY_RANGE })} aria-label={`Remove ${filterLabel(k)} range`}>
              {filterLabel(k)}: {r.from || '…'} to {r.to || '…'} ✕
            </button>
          ))}
          <button type="button" className="link" onClick={() => { setSelections({}); setDates({}); }}>Clear all filters</button>
        </div>
      )}

      {ready ? (
        <section className="results">
          <div className="results-bar">
            <span>{title}</span>
            <button type="button" className="export" disabled={!rows.length}
              onClick={() => downloadCsv('insights-summary.csv', columns, rows.map((r) => r.map(format)))}>Export CSV</button>
          </div>
          {table.loading ? <p className="muted pad">Loading…</p>
            : table.error ? <p className="error pad">Couldn't load results: {table.error}</p>
            : rows.length === 0 ? <p className="muted pad">No rows match these filters.</p>
            : (
              <>
                <DataTable columns={columns} rows={rows} format={format} total={totalRow} numericFrom={activeFields.length} pageSize={12} />
                {rows.length === ROW_LIMIT && <p className="muted">Showing the first {ROW_LIMIT.toLocaleString()} rows.</p>}
                {totals.error && <p className="error">Couldn't load totals: {totals.error}</p>}
              </>
            )}
        </section>
      ) : (
        <section className="empty">
          {patientFiltersAvailable ? (
            <>
              <p><strong>Pick at least one field and one measure</strong> to build a table.</p>
              <p className="muted">For example: Enrolling HCP Territory + New patients filled.</p>
            </>
          ) : (
            <p><strong>3PL and ATU Survey data are not available yet.</strong> Select SP/HUB to build a table.</p>
          )}
        </section>
      )}
    </div>
  );
}
