import { useEffect, useMemo, useState } from 'react';
import { DATE_FILTERS, FIELDS, FILTER_GROUPS, MEASURES, SOURCES, type SourceId } from '../config/model';
import { fieldLabel, formatValue, getSummary, type DateRange as Range, type Filters, type SummaryRow } from '../data/api';
import { MultiSelect } from '../components/MultiSelect';
import { DateRange } from '../components/DateRange';
import { DataTable, downloadCsv } from '../components/DataTable';

const EMPTY_RANGE: Range = { from: '', to: '' };

export function Summary() {
  const [sources, setSources] = useState<SourceId[]>(['sphub']);
  const [fields, setFields] = useState<string[]>(['enrolling_hcp_territory']);
  const [measures, setMeasures] = useState<string[]>(['npf']);
  const [fieldSearch, setFieldSearch] = useState('');
  const [activeGroup, setActiveGroup] = useState<string | null>('patient');
  const [filters, setFilters] = useState<Filters>({});
  const [dates, setDates] = useState<Record<string, Range>>({});
  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [loading, setLoading] = useState(false);

  // ── Conditional visibility: what can be picked depends on the selected sources ──
  const visibleFields = useMemo(
    () => FIELDS.filter((f) => f.sources.some((s) => sources.includes(s)) && f.label.toLowerCase().includes(fieldSearch.toLowerCase())),
    [sources, fieldSearch],
  );
  const visibleMeasures = useMemo(() => MEASURES.filter((m) => sources.includes(m.source)), [sources]);
  const patientFiltersAvailable = sources.includes('sphub');

  // Drop selections that are no longer visible after a source change
  const activeFields = fields.filter((id) => FIELDS.find((f) => f.id === id)!.sources.some((s) => sources.includes(s)));
  const activeMeasures = measures.filter((id) => visibleMeasures.some((m) => m.id === id));
  const ready = activeFields.length > 0 && activeMeasures.length > 0;

  const appliedFilters = Object.entries(filters).filter(([, v]) => v.length > 0);
  const appliedDates = Object.entries(dates).filter(([, r]) => r.from || r.to);

  useEffect(() => {
    if (!ready) { setRows([]); return; }
    setLoading(true);
    getSummary(activeFields, activeMeasures, filters).then((r) => { setRows(r); setLoading(false); });
  }, [activeFields.join(), activeMeasures.join(), JSON.stringify(filters), JSON.stringify(dates)]);

  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const measureDefs = activeMeasures.map((id) => MEASURES.find((m) => m.id === id)!);

  const title = ready
    ? `${measureDefs.map((m) => m.label).join(', ')} by ${activeFields.map(fieldLabel).join(', ')} | Filters Applied On: ${
        [...appliedFilters.map(([k]) => k), ...appliedDates.map(([k]) => k)].join('; ') || 'none'}`
    : '';

  const columns = [...activeFields.map(fieldLabel), ...measureDefs.map((m) => m.label)];
  const tableRows = rows.map((r) => [...r.keys, ...r.values.map((v, i) => formatValue(v, measureDefs[i].format))]);
  const totalRow = ready
    ? [...activeFields.map((_, i) => (i === 0 ? 'Total' : '')), ...measureDefs.map((m, i) => {
        const vals = rows.map((r) => r.values[i]);
        const agg = m.format === 'count' || m.format === 'usd' ? vals.reduce((a, b) => a + b, 0) : vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
        return formatValue(agg, m.format);
      })]
    : undefined;

  const group = FILTER_GROUPS.find((g) => g.id === activeGroup);

  return (
    <div className="page summary">
      <div className="source-row">
        <MultiSelect
          label="Select Source"
          options={SOURCES.map((s) => s.label)}
          value={SOURCES.filter((s) => sources.includes(s.id)).map((s) => s.label)}
          onChange={(labels) => setSources(SOURCES.filter((s) => labels.includes(s.label)).map((s) => s.id))}
        />
        <p className="hint">Fields, measures and filters below change with the selected source.</p>
      </div>

      <div className="builder">
        <section className="builder-box">
          <h3 className="box-title">Select Fields</h3>
          <input className="search" type="search" placeholder="Search fields" aria-label="Search fields" value={fieldSearch} onChange={(e) => setFieldSearch(e.target.value)} />
          <div className="check-list">
            {visibleFields.length === 0 && <p className="muted">No fields for this source.</p>}
            {visibleFields.map((f) => (
              <label key={f.id} className="check">
                <input type="checkbox" checked={fields.includes(f.id)} onChange={() => toggle(fields, setFields, f.id)} />
                {f.label}
              </label>
            ))}
          </div>
        </section>

        <section className="builder-box">
          <h3 className="box-title">Select Measures</h3>
          <div className="check-list">
            {visibleMeasures.length === 0 && <p className="muted">Select a source to see measures.</p>}
            {visibleMeasures.map((m) => (
              <label key={m.id} className="check" title={m.definition}>
                <input type="checkbox" checked={measures.includes(m.id)} onChange={() => toggle(measures, setMeasures, m.id)} />
                {m.label}
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
                    <DateRange key={d} label={d} value={dates[d] ?? EMPTY_RANGE} onChange={(r) => setDates({ ...dates, [d]: r })} />
                  ))
                : group.filters.map((f) => (
                    <MultiSelect key={f.id} label={f.label} options={f.options} value={filters[f.id] ?? []}
                      onChange={(v) => setFilters({ ...filters, [f.id]: v })} />
                  ))}
            </div>
          </section>
        )}
      </div>

      {(appliedFilters.length > 0 || appliedDates.length > 0) && (
        <div className="chips" aria-label="Applied filters">
          {appliedFilters.map(([k, v]) => (
            <button key={k} type="button" className="chip" onClick={() => setFilters({ ...filters, [k]: [] })} aria-label={`Remove filter ${k}`}>
              {k}: {v.join(', ')} ✕
            </button>
          ))}
          {appliedDates.map(([k, r]) => (
            <button key={k} type="button" className="chip" onClick={() => setDates({ ...dates, [k]: EMPTY_RANGE })} aria-label={`Remove ${k} range`}>
              {k}: {r.from || '…'} to {r.to || '…'} ✕
            </button>
          ))}
          <button type="button" className="link" onClick={() => { setFilters({}); setDates({}); }}>Clear all filters</button>
        </div>
      )}

      {ready ? (
        <section className="results">
          <div className="results-bar">
            <span>{title}</span>
            <button type="button" className="export" onClick={() => downloadCsv('insights-summary.csv', columns, tableRows)}>Export CSV</button>
          </div>
          {loading ? <p className="muted pad">Loading…</p> : (
            <DataTable columns={columns} rows={tableRows} total={totalRow} numericFrom={activeFields.length} pageSize={12} />
          )}
        </section>
      ) : (
        <section className="empty">
          <p><strong>Pick at least one field and one measure</strong> to build a table.</p>
          <p className="muted">For example: Enrolling HCP Territory + New patients filled.</p>
        </section>
      )}
    </div>
  );
}
