import { useMemo, useState, type ReactElement } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { CHART_FILTERS, measureLabel } from '../config/model';
import {
  api, byName, formatValue, useApi, useFilterOptions,
  type ApiFilters, type DateBasis, type FieldMeta, type Loadable, type QueryResult, type Row, type Value,
} from '../data/api';
import { useFilters, pageFilters } from '../state/filters';
import { MultiSelect } from '../components/MultiSelect';
import { CARD_BG, INK, OTHER_COLOR, SERIES } from '../config/palette';
import { AppliedFilters } from '../components/AppliedFilters';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { downloadCsv } from '../components/DataTable';
import { isChart, type VisualConfig } from '../visuals/config';
import { chartPanels, usePersonalizedVisual, visualCsv } from '../visuals/data';
import { VisualBody } from '../visuals/VisualBody';
import { PersonalizeButton, PersonalizePanel } from '../visuals/PersonalizePanel';

const C = { light: '#118DFF', navy: '#12239E', orange: '#E66C37', grey: '#A19F9D', pale: '#A9C9F0' };
const STACK_COLORS = [C.navy, C.light, C.orange, C.grey, C.pale, '#6B007B', '#E044A7', '#744EC2'];
const SECTIONS = ['Patient Access', 'Demand Volume & Shipments', 'New Patients Written', 'Persistence', 'Reported Adherence', 'Net Sales', 'Patient Status'] as const;
type Section = (typeof SECTIONS)[number];
const LIVE_SECTIONS: Section[] = ['Patient Access', 'Demand Volume & Shipments', 'New Patients Written', 'Persistence', 'Patient Status'];
const KNOWN_SP_NOTE = 'Power BI note “Excludes Known SP”: that exclusion is not defined in the backend yet, so it is not applied.';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Month start from the backend ("2025-03-01") → "Mar 25". */
function monthLabel(v: Value) {
  const [y, m] = String(v).split('-');
  return v !== null && m ? `${MONTHS[Number(m) - 1]} ${y.slice(2)}` : formatValue(v);
}

type ChartRow = Record<string, Value>;
interface ChartData { rows: ChartRow[]; fields: Record<string, FieldMeta> }

/** Monthly series from /api/trend (the first result column is the month). */
function useTrend(dateBasis: DateBasis | null, measures: string[], filters: ApiFilters): Loadable<ChartData> {
  const body = dateBasis ? { date_basis: dateBasis, grain: 'month' as const, measures, filters } : null;
  const res = useApi(body ? JSON.stringify(['trend', body]) : null, () => api.trend(body!));
  const data = res.data && {
    rows: res.data.rows.map((r) => ({ ...r, label: monthLabel(r[res.data!.columns[0]]) })),
    fields: byName(res.data.fields),
  };
  return { ...res, data };
}

const pctTick = (v: number) => `${Math.round(v * 100)}%`;
const axis = { fontSize: 11, fill: '#605E5C' };
const tooltip = (fields: Record<string, FieldMeta> = {}) =>
  (value: unknown, _name: unknown, item: { dataKey?: unknown }) => formatValue(value as Value, fields[String(item.dataKey)]);

/**
 * "Personalize this visual" for a chart: `defaults` describes the designed chart as a visual config
 * (the starting point in the panel), `filters` includes any filter the chart always applies, and
 * `scope` says so while the chart is personalized.
 */
interface Personalize { id: string; defaults: VisualConfig; filters: ApiFilters; scope?: string }
const NO_FILTERS: ApiFilters = {};
const month = (basis: DateBasis) => `${basis}_by_month`;

function ChartCard({ title, note, state, children, personalize }: {
  title: string; note?: string; state: Loadable<{ rows: unknown[] }>; children: ReactElement; personalize?: Personalize;
}) {
  const [open, setOpen] = useState(false);
  const visual = usePersonalizedVisual({ id: personalize?.id ?? null, defaults: personalize?.defaults ?? null, filters: personalize?.filters ?? NO_FILTERS, loadDefault: false });
  const custom = visual.override; // personalized: drawn from /api/query instead of the designed chart
  const message = state.loading ? 'Loading…'
    : state.error ? `Couldn't load data: ${state.error}`
    : !state.data?.rows.length ? 'No data for these filters.'
    : null;
  const exportCsv = () => {
    if (!visual.data.data) return;
    const csv = visualCsv(visual.data.data, visual.label);
    downloadCsv(`${personalize!.id}.csv`, csv.header, csv.rows);
  };
  return (
    <section className="chart-card">
      <div className="card-head">
        <h3>{custom ? visual.title : title}</h3>
        {custom && <span className="tag personalized">Personalized</span>}
        {custom && <button type="button" className="link" disabled={!visual.data.data?.leaf.length} onClick={exportCsv}>Export CSV</button>}
        {personalize && <PersonalizeButton open={open} onClick={() => setOpen(!open)} />}
      </div>
      {custom ? personalize?.scope && <p className="muted">{personalize.scope}</p> : note && <p className="muted">{note}</p>}
      {custom ? (
        <div className={isChart(custom.type) && !(visual.data.data && chartPanels(visual.data.data).length > 1) ? 'chart-area' : 'chart-free'}>
          {visual.data.loading ? <p className="chart-msg">Loading…</p>
            : visual.data.error ? <p className="chart-msg error">Couldn't load data: {visual.data.error}</p>
            : visual.data.data && (
              <ErrorBoundary what="this visual" resetKey={JSON.stringify(visual.data.data.config)} actions={[{ label: 'Reset to default', run: visual.reset }]}>
                <VisualBody data={visual.data.data} label={visual.label} />
              </ErrorBoundary>
            )}
        </div>
      ) : (
        <div className="chart-area">
          {message ? <p className={`chart-msg ${state.error ? 'error' : ''}`}>{message}</p>
            : <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>}
        </div>
      )}
      {open && <PersonalizePanel visual={visual} onClose={() => setOpen(false)} />}
    </section>
  );
}

/** A designed visual whose data the backend does not serve yet. */
function Unavailable({ title, note, reason }: { title: string; note?: string; reason: string }) {
  return (
    <section className="chart-card unavailable">
      <h3>{title}</h3>
      {note && <p className="muted">{note}</p>}
      <div className="chart-area"><p className="chart-msg"><span><strong>Not available yet.</strong> {reason}</span></p></div>
    </section>
  );
}

function PatientAccess({ filters }: { filters: ApiFilters }) {
  const init = useTrend('enrollment', ['pct_initiate_therapy'], filters);
  const prog = useTrend('enrollment', ['pct_initiate_therapy', 'pct_initiate_sp', 'pct_initiate_paid'], filters);
  // Eligible cohort: enrolled at least 60 days ago (metric-view column SP_Start_60d_include_rule).
  const sixty = useTrend('enrollment', ['pct_initiate_sp_excludes_ft', 'pct_initiate_paid_exclude_ft'], { ...filters, SP_Start_60d_include_rule: [1] });
  const ft = useTrend('first_fill', ['new_patients_filled', 'initiated_not_ft_count', 'pct_initiated_not_ft'], freeTrialCohort(filters));
  return (
    <>
      <h2 className="section-heading">Patient Access Metrics</h2>
      <div className="chart-grid">
        <ChartCard title="SP/HUB Patients Initiating Therapy by Enrollment Month" note={KNOWN_SP_NOTE} state={init}
          personalize={{ id: 'charts-initiating-therapy', filters, defaults: { type: 'clustered-column', rows: ['enrollment_by_month'], columns: null, values: ['pct_initiate_therapy'] } }}>
          <BarChart data={init.data?.rows}><CartesianGrid vertical={false} stroke="#EDEDED" /><XAxis dataKey="label" tick={axis} /><YAxis tick={axis} tickFormatter={pctTick} domain={[0, 1]} /><Tooltip formatter={tooltip(init.data?.fields)} />
            <Bar dataKey="pct_initiate_therapy" name={measureLabel('pct_initiate_therapy')} fill={C.light} /></BarChart>
        </ChartCard>
        <FreeTrialProgression state={ft} />
        <ChartCard title="SP/HUB Patients – progression to SP shipments" note={KNOWN_SP_NOTE} state={prog}
          personalize={{ id: 'charts-progression', filters, defaults: { type: 'line', rows: ['enrollment_by_month'], columns: null, values: ['pct_initiate_therapy', 'pct_initiate_sp', 'pct_initiate_paid'] } }}>
          <LineChart data={prog.data?.rows}><CartesianGrid vertical={false} stroke="#EDEDED" /><XAxis dataKey="label" tick={axis} /><YAxis tick={axis} tickFormatter={pctTick} domain={[0, 1]} /><Tooltip formatter={tooltip(prog.data?.fields)} /><Legend wrapperStyle={{ fontSize: 11 }} />
            <Line dataKey="pct_initiate_therapy" name="%_Initiate_Therapy" stroke={C.light} strokeWidth={2} dot={false} />
            <Line dataKey="pct_initiate_sp" name="%_Initiate_SP" stroke={C.navy} strokeWidth={2} dot={false} />
            <Line dataKey="pct_initiate_paid" name="%_Initiate_Paid" stroke={C.orange} strokeWidth={2} dot={false} /></LineChart>
        </ChartCard>
        <ChartCard title="% of SP/HUB Patients Initiating SP Therapy within 60 days of Enrollment"
          note={`Free Trial excluded; enrollments at least 60 days old (SP_Start_60d_include_rule = 1). ${KNOWN_SP_NOTE}`} state={sixty}
          personalize={{
            id: 'charts-sp-60-days', filters: { ...filters, SP_Start_60d_include_rule: [1] }, scope: 'Enrollments at least 60 days old (SP_Start_60d_include_rule = 1).',
            defaults: { type: 'clustered-column', rows: ['enrollment_by_month'], columns: null, values: ['pct_initiate_sp_excludes_ft', 'pct_initiate_paid_exclude_ft'] },
          }}>
          <BarChart data={sixty.data?.rows}><CartesianGrid vertical={false} stroke="#EDEDED" /><XAxis dataKey="label" tick={axis} /><YAxis tick={axis} tickFormatter={pctTick} domain={[0, 1]} /><Tooltip formatter={tooltip(sixty.data?.fields)} /><Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="pct_initiate_sp_excludes_ft" name="%_Initiate_SP_Excludes_FT" fill={C.light} />
            <Bar dataKey="pct_initiate_paid_exclude_ft" name="%_Initiate_Paid_Exclude_FT" fill={C.navy} /></BarChart>
        </ChartCard>
      </div>
    </>
  );
}

const DEMAND: { id: string; label: string; title: string; target?: number; measure?: string; basis?: DateBasis; basisLabel?: string; reason?: string; onDrug?: boolean }[] = [
  { id: 'npw', label: 'NBRx', title: 'New Patients Written (NBRx)', target: 526, measure: 'new_patients_written', basis: 'enrollment', basisLabel: 'By enrollment month' },
  { id: 'npf', label: 'NPF', title: 'New Patients Filled', target: 449, measure: 'new_patients_filled', basis: 'first_fill', basisLabel: 'By first fill month' },
  { id: 'pod', label: 'Patients on Drug', title: 'Total Patients on Drug', target: 426, onDrug: true, basisLabel: 'New (first fill that month) + continuing, until discontinued' },
  { id: 'trx', label: 'TRx', title: 'TRx Volume – Monthly Fills', reason: 'TRx needs fill-level data; attruby_ia has first fills only.' },
  { id: 'units', label: 'Units', title: 'Units Dispensed – Monthly', target: 2776, reason: '3PL data is not connected to the backend yet.' },
  { id: 'ship', label: 'Total Shipments', title: 'Total Shipments', reason: 'attruby_ia has a shipment total per patient but no shipment dates, so shipments cannot be shown by month.' },
];

function Demand({ filters }: { filters: ApiFilters }) {
  const [sel, setSel] = useState(DEMAND[0]);
  const data = useTrend(sel.basis ?? null, sel.measure ? [sel.measure] : [], filters);
  const note = [sel.basisLabel, sel.target ? `2027 YE target: ${sel.target.toLocaleString()}` : ''].filter(Boolean).join(' · ');
  return (
    <>
      <div className="segmented" role="group" aria-label="Select measure">
        {DEMAND.map((d) => (
          <button key={d.id} type="button" aria-pressed={sel.id === d.id} className={sel.id === d.id ? 'on' : ''} onClick={() => setSel(d)}>{d.label}</button>
        ))}
      </div>
      <div className="chart-grid one">
        {sel.onDrug ? (
          <PatientsOnDrugChart title={`${sel.title} – Monthly`} note={note} filters={filters} />
        ) : sel.measure ? (
          <ChartCard title={`${sel.title} – Monthly`} note={note} state={data}
            personalize={{ id: `charts-demand-${sel.id}`, filters, defaults: { type: 'clustered-column', rows: [month(sel.basis ?? 'enrollment')], columns: null, values: [sel.measure] } }}>
            <BarChart data={data.data?.rows}><CartesianGrid vertical={false} stroke="#EDEDED" /><XAxis dataKey="label" tick={axis} /><YAxis tick={axis} /><Tooltip formatter={tooltip(data.data?.fields)} />
              <Bar dataKey={sel.measure} name={sel.label} fill={C.light} /></BarChart>
          </ChartCard>
        ) : (
          <Unavailable title={`${sel.title} – Monthly`} note={note} reason={sel.reason ?? ''} />
        )}
      </div>
    </>
  );
}

function Persistence({ filters }: { filters: ApiFilters }) {
  return (
    <div className="chart-grid one">
      <DiscontinuationChart filters={filters} />
    </div>
  );
}

function ReportedAdherence() {
  const reason = 'ATU survey data is not connected to the backend yet.';
  return (
    <div className="chart-grid">
      <Unavailable title="Patient Reported Adherence – by ATU Wave" note="“How often, if ever, do you miss a dose?”" reason={reason} />
      <Unavailable title="Patient Reported Persistence – by ATU Wave" note="% of patients starting and reporting remaining on therapy" reason={reason} />
    </div>
  );
}

function NetSales() {
  return (
    <div className="chart-grid one">
      <Unavailable title="Net Sales – Actual vs Forecast, Monthly ($M)" note="2027 YE target: $114M · after GTN adjustments"
        reason="3PL sales and forecast data are not connected to the backend yet." />
    </div>
  );
}

/** Rows of (month, status, value) → one row per month with a column per status. */
function pivotByStatus(result?: QueryResult) {
  const months = new Map<string, ChartRow>();
  const statuses = new Set<string>();
  for (const r of result?.rows ?? []) {
    if (r.enrollment_by_month === null) continue; // no enrollment date: cannot be placed on the month axis
    const month = String(r.enrollment_by_month);
    const status = formatValue(r.current_status); // null → "(Blank)"
    statuses.add(status);
    const row = months.get(month) ?? { label: monthLabel(month) };
    row[status] = r.new_patients_written;
    months.set(month, row);
  }
  return { rows: [...months.values()], statuses: [...statuses].sort() };
}

function PatientStatus({ filters }: { filters: ApiFilters }) {
  const body = { measures: ['new_patients_written'], dimensions: ['enrollment_by_month', 'current_status'], filters, order_by: ['enrollment_by_month'] };
  const res = useApi(JSON.stringify(['status', body]), () => api.query(body));
  const { rows, statuses } = useMemo(() => pivotByStatus(res.data), [res.data]);
  const written = byName(res.data?.fields).new_patients_written;
  return (
    <div className="chart-grid one">
      <ChartCard title="NBRx by Status – Monthly" note="New patients written by enrollment month, split by current status" state={{ ...res, data: res.data && { rows } }}
        personalize={{ id: 'charts-nbrx-status', filters, defaults: { type: 'stacked-column', rows: ['enrollment_by_month'], columns: 'current_status', values: ['new_patients_written'] } }}>
        <BarChart data={rows}><CartesianGrid vertical={false} stroke="#EDEDED" /><XAxis dataKey="label" tick={axis} /><YAxis tick={axis} /><Tooltip formatter={(v) => formatValue(v as Value, written)} /><Legend wrapperStyle={{ fontSize: 11 }} />
          {statuses.map((s, i) => (
            <Bar key={s} dataKey={(row: ChartRow) => row[s] ?? null} name={s} stackId="s" fill={STACK_COLORS[i % STACK_COLORS.length]} />
          ))}</BarChart>
      </ChartCard>
    </div>
  );
}

// ---- Charts built from attruby_ia's patient timeline (first fill, status, specialty) ---------------- //
const legendText = (value: string) => <span style={{ color: INK }}>{value}</span>;
const pctTickFine = (v: number) => `${(v * 100).toFixed(Math.abs(v) < 0.1 && v !== 0 ? 1 : 0)}%`;
const pct1 = new Intl.NumberFormat(undefined, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 });
const whole = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

function chartMessage(state: Loadable<{ rows: unknown[] }>) {
  return state.loading ? 'Loading…'
    : state.error ? `Couldn't load data: ${state.error}`
    : !state.data?.rows.length ? 'No data for these filters.'
    : null;
}

/** Combines two loads into one chart state (error/loading if either is). */
function combine<A, B, T extends { rows: unknown[] }>(a: Loadable<A>, b: Loadable<B>, build: (a: A, b: B) => T): Loadable<T> {
  if (a.error || b.error) return { loading: false, error: a.error ?? b.error };
  if (a.loading || b.loading || !a.data || !b.data) return { loading: true };
  return { loading: false, data: build(a.data, b.data) };
}

function mapLoad<A, T extends { rows: unknown[] }>(a: Loadable<A>, build: (a: A) => T): Loadable<T> {
  return combine(a, a, (x) => build(x));
}

/**
 * Power BI "Excludes FT ONLY": patients whose first fill was a Free Trial shipment, leaving out
 * programs that are Free Trial alone or blank (like the Exclude_FT measures). The page's program
 * slicer still applies.
 */
function freeTrialCohort(filters: ApiFilters): ApiFilters {
  const program = filters.prgrm_nm;
  return {
    ...filters,
    first_fill_shipment_type: ['Free Trial'],
    prgrm_nm: { ...(Array.isArray(program) ? { in: program } : {}), not_in: ['Free Trial', null] },
  };
}

/** Counts and the progression rate have different scales, so they get one axis each (two panels, shared months). */
function FreeTrialProgression({ state }: { state: Loadable<ChartData> }) {
  const message = chartMessage(state);
  const rows = state.data?.rows;
  const fields = state.data?.fields;
  return (
    <section className="chart-card">
      <h3>By Free Trial Month – % of Patients that Progress to SP Filled</h3>
      <p className="muted">
        FT shipment month (initial fill only): first fill shipment type “Free Trial”. Excludes FT ONLY (program Free Trial alone or blank). {KNOWN_SP_NOTE}
      </p>
      <div className="chart-area split">
        {message ? <p className={`chart-msg ${state.error ? 'error' : ''}`}>{message}</p> : (
          <>
            <div className="chart-panel">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} syncId="ft-progression"><CartesianGrid vertical={false} stroke="#EDEDED" /><XAxis dataKey="label" tick={axis} hide /><YAxis tick={axis} width={40} /><Tooltip formatter={tooltip(fields)} /><Legend wrapperStyle={{ fontSize: 11 }} formatter={legendText} />
                  <Bar dataKey="new_patients_filled" name="Patients with Initial FT Shipment" fill={SERIES[0]} stroke={CARD_BG} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="initiated_not_ft_count" name="Patients with subsequent SP Filled" fill={SERIES[2]} stroke={CARD_BG} radius={[4, 4, 0, 0]} /></BarChart>
              </ResponsiveContainer>
            </div>
            <div className="chart-panel">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} syncId="ft-progression"><CartesianGrid vertical={false} stroke="#EDEDED" /><XAxis dataKey="label" tick={axis} /><YAxis tick={axis} tickFormatter={pctTick} domain={[0, 1]} width={40} /><Tooltip formatter={tooltip(fields)} /><Legend wrapperStyle={{ fontSize: 11 }} formatter={legendText} />
                  <Line dataKey="pct_initiated_not_ft" name="% Initiated_not_FT" stroke={SERIES[1]} strokeWidth={2} dot={false} /></LineChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/** Monthly patients on drug, discontinuations and launch-cohort persistence (POST /api/patients-on-drug). */
function useOnDrug(filters: ApiFilters): Loadable<ChartData & { launch: string | null; cohortMonths: number }> {
  const res = useApi(JSON.stringify(['on-drug', filters]), () => api.patientsOnDrug(filters));
  const data = res.data && {
    rows: res.data.rows.map((r) => ({ ...r, label: monthLabel(r.month) })),
    fields: byName(res.data.fields),
    launch: res.data.meta.launch_month,
    cohortMonths: res.data.meta.launch_cohort_months,
  };
  return { ...res, data };
}

function PatientsOnDrugChart({ title, note, filters }: { title: string; note: string; filters: ApiFilters }) {
  const data = useOnDrug(filters);
  return (
    <ChartCard title={title} note={note} state={data}>
      <BarChart data={data.data?.rows}><CartesianGrid vertical={false} stroke="#EDEDED" /><XAxis dataKey="label" tick={axis} /><YAxis tick={axis} /><Tooltip formatter={tooltip(data.data?.fields)} /><Legend wrapperStyle={{ fontSize: 11 }} formatter={legendText} />
        <Bar dataKey="continuing_patients_on_drug" name="Continuing" stackId="pod" fill={SERIES[0]} stroke={CARD_BG} />
        <Bar dataKey="new_patients_on_drug" name="New" stackId="pod" fill={SERIES[1]} stroke={CARD_BG} radius={[4, 4, 0, 0]} /></BarChart>
    </ChartCard>
  );
}

const DISCONTINUATION_TARGET = 0.137;

function DiscontinuationChart({ filters }: { filters: ApiFilters }) {
  const data = useOnDrug(filters);
  const launch = data.data?.launch;
  const cohort = launch
    ? `launch cohort = first fill ${monthLabel(launch)} to ${monthLabel(addMonths(launch, (data.data?.cohortMonths ?? 4) - 1))}`
    : 'launch cohort = first 4 months of first fills';
  return (
    <ChartCard title="Discontinuation – Monthly Rate & Launch-Cohort Cumulative"
      note={`Target: cumulative discontinuation below 13.7%. Monthly rate = patients discontinued that month ÷ patients on drug that month; ${cohort}. Discontinued = current status Discontinued, dated by status change date.`}
      state={data}>
      <ComposedChart data={data.data?.rows}><CartesianGrid vertical={false} stroke="#EDEDED" /><XAxis dataKey="label" tick={axis} /><YAxis tick={axis} tickFormatter={pctTickFine} /><Tooltip formatter={tooltip(data.data?.fields)} /><Legend wrapperStyle={{ fontSize: 11 }} formatter={legendText} />
        <ReferenceLine y={DISCONTINUATION_TARGET} stroke={OTHER_COLOR} strokeDasharray="4 4" label={{ value: 'Target 13.7%', position: 'insideTopRight', fontSize: 11, fill: INK }} />
        <Bar dataKey="discontinuation_rate" name="Monthly discontinuation rate" fill={SERIES[0]} stroke={CARD_BG} radius={[4, 4, 0, 0]} />
        <Line dataKey="launch_cohort_cum_discontinuation" name="Launch cohort cumulative discontinuation" stroke={SERIES[1]} strokeWidth={2} dot={false} connectNulls /></ComposedChart>
    </ChartCard>
  );
}

/** "2025-03-01" + n months → "2025-06-01". */
function addMonths(month: string, n: number) {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`;
}

// ---- Attruby New Patients Written (enrollments), by Enrollment Source --------------------------------- //
const SOURCE_FIELD = 'enrolling_hcp_specialty'; // "Enrollment Source" in the Power BI visuals
const NAMED_SOURCES = 7;                        // the rest fold into one series so colors stay distinguishable
const ALL_OTHER = 'All other sources';
const SOURCE_ORDER = ['(Blank)', 'Cardiology'];  // the two largest keep the first two colors

interface SourceSeries { names: string[]; color: Record<string, string>; seriesOf: (v: Value) => string }

/** Top sources by life-to-date volume get a name and a fixed color; the rest become "All other sources". */
function sourceSeries(ltd: QueryResult): SourceSeries {
  const ranked = ltd.rows.map((r) => formatValue(r[SOURCE_FIELD])).slice(0, NAMED_SOURCES);
  const folded = ltd.rows.length > NAMED_SOURCES;
  const named = [...ranked].sort((a, b) => {
    const ia = SOURCE_ORDER.indexOf(a), ib = SOURCE_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  const color: Record<string, string> = Object.fromEntries(named.map((n, i) => [n, SERIES[i]]));
  color[ALL_OTHER] = OTHER_COLOR;
  const keep = new Set(named);
  return {
    names: folded ? [...named, ALL_OTHER] : named,
    color,
    seriesOf: (v) => (keep.has(formatValue(v)) ? formatValue(v) : ALL_OTHER),
  };
}

/** (period, source, value) rows → one row per period with a column per source series. */
function pivotBySource(rows: Row[], period: string, measure: string, series: SourceSeries, label: (v: Value) => string) {
  const periods = new Map<string, ChartRow>();
  for (const r of rows) {
    if (r[period] === null) continue; // no date: cannot be placed on the axis
    const key = String(r[period]);
    const row = periods.get(key) ?? { label: label(key), __total: 0 };
    const name = series.seriesOf(r[SOURCE_FIELD]);
    const value = Number(r[measure] ?? 0);
    row[name] = Number(row[name] ?? 0) + value;
    row.__total = Number(row.__total) + value;
    periods.set(key, row);
  }
  return [...periods.values()];
}

/** "2025-04-19" → "4/19/25" (Power BI week-ending axis). */
function weekLabel(v: Value) {
  const [y, m, d] = String(v).split('-');
  return d ? `${Number(m)}/${Number(d.slice(0, 2))}/${y.slice(2)}` : formatValue(v);
}

function NewPatientsWritten({ filters }: { filters: ApiFilters }) {
  const ltdBody = { measures: ['new_patients_written'], dimensions: [SOURCE_FIELD], filters, order_by: ['-new_patients_written'] };
  const monthBody = { measures: ['new_patients_written'], dimensions: ['enrollment_by_month', SOURCE_FIELD], filters, order_by: ['enrollment_by_month'] };
  const weekBody = { measures: ['new_patients_filled'], dimensions: ['enrollment_by_week', SOURCE_FIELD], filters, order_by: ['enrollment_by_week'] };
  const ltd = useApi(JSON.stringify(['npw-ltd', ltdBody]), () => api.query(ltdBody));
  const monthly = useApi(JSON.stringify(['npw-month', monthBody]), () => api.query(monthBody));
  const weekly = useApi(JSON.stringify(['npw-week', weekBody]), () => api.query(weekBody));

  const share = combine(ltd, monthly, (l, m) => {
    const series = sourceSeries(l);
    return { series, rows: pivotBySource(m.rows, 'enrollment_by_month', 'new_patients_written', series, monthLabel) };
  });
  const trend = combine(ltd, weekly, (l, w) => {
    const series = sourceSeries(l);
    return { series, rows: pivotBySource(w.rows, 'enrollment_by_week', 'new_patients_filled', series, weekLabel) };
  });
  const total = mapLoad(ltd, (l) => {
    const series = sourceSeries(l);
    const sum = l.rows.reduce((s, r) => s + Number(r.new_patients_written ?? 0), 0);
    const bySeries = new Map<string, number>();
    for (const r of l.rows) {
      const name = series.seriesOf(r[SOURCE_FIELD]);
      bySeries.set(name, (bySeries.get(name) ?? 0) + Number(r.new_patients_written ?? 0));
    }
    const rows = [...bySeries].map(([name, value]) => {
      const part = sum ? value / sum : 0;
      return { name, value, share: part, text: `${compact.format(value)} (${pct1.format(part)})` };
    }).sort((a, b) => (a.name === ALL_OTHER ? 1 : b.name === ALL_OTHER ? -1 : b.value - a.value));
    return { series, rows };
  });

  // Tooltip for stacked bars: count and its share of the period.
  const countAndShare = (value: unknown, _name: unknown, item: { payload?: ChartRow }) => {
    const all = Number(item.payload?.__total ?? 0);
    return `${whole.format(Number(value))}${all ? ` (${pct1.format(Number(value) / all)})` : ''}`;
  };

  return (
    <>
      <h2 className="section-heading">Attruby New Patients Written (enrollments)</h2>
      <p className="muted">
        Enrollment Source = enrolling HCP specialty; the {NAMED_SOURCES} largest sources are named, the rest are combined as “{ALL_OTHER}”.
        The Power BI “NPW Group” slicer is not shown: attruby_ia has no NPW Group column.
      </p>
      <div className="chart-grid">
        <ChartCard title="Monthly Share" note="New patients written by enrollment month, share by Enrollment Source" state={share}
          personalize={{ id: 'charts-npw-monthly-share', filters, defaults: { type: 'stacked-column', rows: ['enrollment_by_month'], columns: SOURCE_FIELD, values: ['new_patients_written'] } }}>
          <BarChart data={share.data?.rows} stackOffset="expand"><CartesianGrid vertical={false} stroke="#EDEDED" /><XAxis dataKey="label" tick={axis} /><YAxis tick={axis} tickFormatter={pctTick} /><Tooltip formatter={countAndShare} /><Legend wrapperStyle={{ fontSize: 11 }} formatter={legendText} />
            {share.data?.series.names.map((s) => (
              <Bar key={s} dataKey={(row: ChartRow) => row[s] ?? 0} name={s} stackId="share" fill={share.data!.series.color[s]} stroke={CARD_BG} />
            ))}</BarChart>
        </ChartCard>
        <ChartCard title="LTD Share" note="Life-to-date new patients written by Enrollment Source" state={total}
          personalize={{ id: 'charts-npw-ltd', filters, defaults: { type: 'clustered-bar', rows: [SOURCE_FIELD], columns: null, values: ['new_patients_written'] } }}>
          <BarChart data={total.data?.rows} layout="vertical" margin={{ right: 90 }}><XAxis type="number" hide /><YAxis type="category" dataKey="name" tick={axis} width={120} />
            <Tooltip formatter={(v: unknown, _n: unknown, item: { payload?: { share: number } }) => `${whole.format(Number(v))} (${pct1.format(item.payload?.share ?? 0)})`} />
            <Bar dataKey="value" name="New patients written" radius={[0, 4, 4, 0]}>
              {total.data?.rows.map((r) => <Cell key={r.name} fill={total.data!.series.color[r.name]} />)}
              <LabelList dataKey="text" position="right" style={{ fontSize: 11, fill: INK }} />
            </Bar></BarChart>
        </ChartCard>
      </div>
      <div className="chart-grid one">
        <ChartCard title="Weekly Enrollment Trend" note="Sum of new_ptnt_filled by enrollment week ending, by Enrollment Source (as in the Power BI visual)" state={trend}
          personalize={{ id: 'charts-npw-weekly', filters, defaults: { type: 'stacked-column', rows: ['enrollment_by_week'], columns: SOURCE_FIELD, values: ['new_patients_filled'] } }}>
          <BarChart data={trend.data?.rows}><CartesianGrid vertical={false} stroke="#EDEDED" /><XAxis dataKey="label" tick={axis} /><YAxis tick={axis} /><Tooltip formatter={countAndShare} /><Legend wrapperStyle={{ fontSize: 11 }} formatter={legendText} />
            {trend.data?.series.names.map((s) => (
              <Bar key={s} dataKey={(row: ChartRow) => row[s] ?? 0} name={s} stackId="week" fill={trend.data!.series.color[s]} stroke={CARD_BG} />
            ))}</BarChart>
        </ChartCard>
      </div>
    </>
  );
}

export function Charts() {
  const [section, setSection] = useState<Section>('Patient Access');
  const { state, setSelection } = useFilters();
  const { filters, applied, notApplied } = pageFilters(state, 'charts');
  const live = LIVE_SECTIONS.includes(section);
  const options = useFilterOptions(live ? CHART_FILTERS.map((s) => s.id) : [], filters);
  return (
    <div className="page charts">
      <nav className="sub-tabs" aria-label="Chart sections">
        {SECTIONS.map((s) => (
          <button key={s} type="button" aria-pressed={section === s} className={section === s ? 'on' : ''} onClick={() => setSection(s)}>{s}</button>
        ))}
      </nav>
      {live && (
        <div className="slicer-row">
          {CHART_FILTERS.map((s) => (
            <MultiSelect key={s.id} label={s.label} options={options.data?.[s.id] ?? []} loading={options.loading}
              value={state.selections[s.id] ?? []} onChange={(v) => setSelection(s.id, v)} />
          ))}
          {options.error && <p className="error">Couldn't load filter values: {options.error}</p>}
        </div>
      )}
      {live && <AppliedFilters applied={applied} notApplied={notApplied} />}
      {section === 'Patient Access' && <PatientAccess filters={filters} />}
      {section === 'Demand Volume & Shipments' && <Demand filters={filters} />}
      {section === 'New Patients Written' && <NewPatientsWritten filters={filters} />}
      {section === 'Persistence' && <Persistence filters={filters} />}
      {section === 'Reported Adherence' && <ReportedAdherence />}
      {section === 'Net Sales' && <NetSales />}
      {section === 'Patient Status' && <PatientStatus filters={filters} />}
    </div>
  );
}
