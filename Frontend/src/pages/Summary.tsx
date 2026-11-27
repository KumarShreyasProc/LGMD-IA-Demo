import { useMemo, useState } from 'react';
import { DATE_FILTERS, FIELDS, FILTER_GROUPS, MEASURES, SOURCES } from '../config/model';
import { useFilterOptions, type ApiFilters, type DateRange as Range } from '../data/api';
import { useFilters, pageFilters } from '../state/filters';
import { MultiSelect } from '../components/MultiSelect';
import { DateRange } from '../components/DateRange';
import { downloadCsv } from '../components/DataTable';
import { AppliedFilters } from '../components/AppliedFilters';
import { isChart, type VisualConfig } from '../visuals/config';
import { chartPanels, usePersonalizedVisual, visualCsv, type Binding } from '../visuals/data';
import { VisualBody } from '../visuals/VisualBody';
import { PersonalizeButton, PersonalizePanel } from '../visuals/PersonalizePanel';

const EMPTY_RANGE: Range = { from: '', to: '' };

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

  // Both visuals show the checked fields (hierarchy in the order they were checked) and measures; their
  // "Personalize this visual" panels edit the same lists, and save only the visual type and Columns.
  const binding: Binding = {
    rows: activeFields,
    values: activeMeasures,
    rowOptions: FIELDS.filter((f) => f.live && f.sources.some((s) => sources.includes(s))).map((f) => f.id),
    valueOptions: visibleMeasures.filter((m) => m.live).map((m) => m.id),
    set: (rows, values) => update({ fields: rows, measures: values }),
  };

  const group = FILTER_GROUPS.find((g) => g.id === activeGroup);
  const options = useFilterOptions(patientFiltersAvailable && group ? group.filters.map((f) => f.id) : [], filters);

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  // Replaces the Power BI "Chart Title" / "Filters_In_Use" / "DateFilters_In_Use" measures.
  const filtersInUse = `Filters Applied On: ${applied.map((f) => f.label).join('; ') || 'none'}`;

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

      {ready && patientFiltersAvailable ? (
        <>
          <SummaryVisual id="summary" filename="insights-summary" binding={binding} filters={filters} titleSuffix={filtersInUse}
            defaults={{ type: 'matrix', rows: [], columns: null, values: [] }} />
          <SummaryVisual id="summary-chart" filename="insights-summary-chart" binding={binding} filters={filters}
            defaults={{ type: 'clustered-column', rows: [], columns: null, values: [] }} />
        </>
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

/**
 * One Summary visual (the table, or the chart below it) with its own personalize panel and export.
 * Rows and values always follow Select Fields / Select Measures (`binding`).
 */
function SummaryVisual({ id, filename, binding, filters, defaults, titleSuffix }: {
  id: string; filename: string; binding: Binding; filters: ApiFilters; defaults: VisualConfig; titleSuffix?: string;
}) {
  const [personalizing, setPersonalizing] = useState(false);
  const visual = usePersonalizedVisual({ id, defaults, filters, loadDefault: true, bound: binding });
  const { data } = visual;
  // CSV export: exactly what the visual shows (flat table, or every value per most detailed row).
  const exportCsv = () => {
    if (!data.data) return;
    const csv = visualCsv(data.data, visual.label);
    downloadCsv(`${filename}.csv`, csv.header, csv.rows);
  };
  const singleChart = data.data && isChart(data.data.config.type) && chartPanels(data.data).length === 1;
  return (
    <section className="results">
      {personalizing && <PersonalizePanel visual={visual} onClose={() => setPersonalizing(false)} />}
      <div className="results-bar">
        <span>{visual.title}{titleSuffix ? ` | ${titleSuffix}` : ''}</span>
        {visual.override && <span className="tag personalized">Personalized</span>}
        <button type="button" className="export" disabled={!data.data?.leaf.length} onClick={exportCsv}>Export CSV</button>
        <PersonalizeButton open={personalizing} onClick={() => setPersonalizing(!personalizing)} />
      </div>
      {data.loading ? <p className="muted pad">Loading…</p>
        : data.error ? <p className="error pad">Couldn't load results: {data.error}</p>
        : data.data && (
          <div className={singleChart ? 'visual-frame' : ''}>
            <VisualBody data={data.data} label={visual.label} />
          </div>
        )}
    </section>
  );
}
