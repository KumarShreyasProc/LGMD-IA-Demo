import { useMemo, useState } from 'react';
import { DATE_FILTERS, FIELDS, FILTER_GROUPS, MEASURES, SOURCES, fieldLabel, measureLabel } from '../config/model';
import { api, byName, formatValue, useApi, useFilterOptions, type DateRange as Range, type Value } from '../data/api';
import { useFilters, pageFilters } from '../state/filters';
import { MultiSelect } from '../components/MultiSelect';
import { DateRange } from '../components/DateRange';
import { downloadCsv } from '../components/DataTable';
import { Matrix } from '../components/Matrix';
import { AppliedFilters } from '../components/AppliedFilters';

const EMPTY_RANGE: Range = { from: '', to: '' };
const ROW_LIMIT = 5000; // per hierarchy level

export function Summary() {
  const { state, update, setSelection, setDate } = useFilters();
  const { sources, fields, measures, selections, dates } = state;
  const [fieldSearch, setFieldSearch] = useState('');
  const [activeGroup, setActiveGroup] = useState<string | null>('patient');

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

  // Shared filters: attribute filters apply to SP/HUB data only, and only the ones with a slicer on this page.
  const page = pageFilters(state, 'summary');
  const filters = patientFiltersAvailable ? page.filters : {};
  const applied = patientFiltersAvailable ? page.applied : [];
  const notApplied = patientFiltersAvailable ? page.notApplied : [...page.applied, ...page.notApplied];

  // Matrix hierarchy follows the order fields were checked. One query per level (fields 1..k), so every
  // subtotal, including ratios, is computed by the backend like a Power BI matrix.
  const levelRequests = activeFields.map((_, i) => ({
    measures: activeMeasures, dimensions: activeFields.slice(0, i + 1), filters, order_by: [`-${activeMeasures[0]}`], limit: ROW_LIMIT,
  }));
  const key = ready ? JSON.stringify(levelRequests) : null;
  const table = useApi(key, () => Promise.all(levelRequests.map((r) => api.query(r))));
  const totals = useApi(key, () => api.kpis(activeMeasures, filters)); // ratio totals need the backend, not a sum of rows

  const group = FILTER_GROUPS.find((g) => g.id === activeGroup);
  const options = useFilterOptions(patientFiltersAvailable && group ? group.filters.map((f) => f.id) : [], filters);

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  // Replaces the Power BI "Chart Title" / "Filters_In_Use" / "DateFilters_In_Use" measures.
  const title = ready
    ? `${activeMeasures.map(measureLabel).join(', ')} by ${activeFields.map(fieldLabel).join(', ')} | Filters Applied On: ${
        applied.map((f) => f.label).join('; ') || 'none'}`
    : '';

  const levels = table.data?.map((r) => r.rows) ?? [];
  const leaf = table.data?.[table.data.length - 1];
  const meta = byName(leaf?.fields);
  const format = (v: Value, name: string) => formatValue(v, meta[name]);
  const truncated = levels.some((rows) => rows.length === ROW_LIMIT);
  const totalMeta = byName(totals.data?.fields);
  const totalRow = totals.data ? activeMeasures.map((m) => formatValue(totals.data!.values[m], totalMeta[m])) : undefined;

  // CSV export: the most detailed level, one column per field (like Power BI's "Export data").
  const names = [...activeFields, ...activeMeasures];
  const exportCsv = () => downloadCsv('insights-summary.csv', [...activeFields.map(fieldLabel), ...activeMeasures.map(measureLabel)],
    (leaf?.rows ?? []).map((r) => names.map((n) => format(r[n] ?? null, n))));

  return (
    <div className="page summary">
      <div className="source-row">
        <MultiSelect
          label="Select Source"
          options={SOURCES.map((s) => s.label)}
          value={SOURCES.filter((s) => sources.includes(s.id)).map((s) => s.label)}
          onChange={(labels) => update({ sources: SOURCES.filter((s) => labels.includes(s.label)).map((s) => s.id) })}
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
                <input type="checkbox" disabled={!f.live} checked={f.live && fields.includes(f.id)} onChange={() => update({ fields: toggle(fields, f.id) })} />
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
                <input type="checkbox" disabled={!m.live} checked={m.live && measures.includes(m.id)} onChange={() => update({ measures: toggle(measures, m.id) })} />
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
                    <DateRange key={d.id} label={d.label} value={dates[d.id] ?? EMPTY_RANGE} onChange={(r) => setDate(d.id, r)} />
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

      <AppliedFilters applied={applied} notApplied={notApplied} />

      {ready ? (
        <section className="results">
          <div className="results-bar">
            <span>{title}</span>
            <button type="button" className="export" disabled={!leaf?.rows.length} onClick={exportCsv}>Export CSV</button>
          </div>
          {table.loading ? <p className="muted pad">Loading…</p>
            : table.error ? <p className="error pad">Couldn't load results: {table.error}</p>
            : !levels[0]?.length ? <p className="muted pad">No rows match these filters.</p>
            : (
              <>
                <Matrix key={key} fields={activeFields} fieldLabels={activeFields.map(fieldLabel)} measures={activeMeasures}
                  measureLabels={activeMeasures.map(measureLabel)} levels={levels} format={format} total={totalRow} />
                {truncated && <p className="muted">Some levels have more than {ROW_LIMIT.toLocaleString()} rows; only the largest are shown. Add filters to narrow it down.</p>}
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
