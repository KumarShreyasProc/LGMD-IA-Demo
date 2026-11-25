import { useMemo, useState, type ReactElement } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { measureLabel } from '../config/model';
import {
  api, byName, formatValue, toApiFilters, useApi, useFilterOptions,
  type ApiFilters, type DateBasis, type FieldMeta, type Loadable, type QueryResult, type Selections, type Value,
} from '../data/api';
import { MultiSelect } from '../components/MultiSelect';

const C = { light: '#118DFF', navy: '#12239E', orange: '#E66C37', grey: '#A19F9D', pale: '#A9C9F0' };
const STACK_COLORS = [C.navy, C.light, C.orange, C.grey, C.pale, '#6B007B', '#E044A7', '#744EC2'];
const SECTIONS = ['Patient Access', 'Demand Volume & Shipments', 'Persistence', 'Reported Adherence', 'Net Sales', 'Patient Status'] as const;
type Section = (typeof SECTIONS)[number];
const LIVE_SECTIONS: Section[] = ['Patient Access', 'Demand Volume & Shipments', 'Patient Status'];
const SLICERS = [
  { id: 'prgrm_nm', label: 'SP/HUB Program Type (prgrm_nm)' },
  { id: 'enrollment_pyr_typ', label: 'Enrollment Payer Type (enrollment_pyr_typ)' },
];
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
  const res = useApi(body ? JSON.stringify(body) : null, () => api.trend(body!));
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

function ChartCard({ title, note, state, children }: { title: string; note?: string; state: Loadable<{ rows: unknown[] }>; children: ReactElement }) {
  const message = state.loading ? 'Loading…'
    : state.error ? `Couldn't load data: ${state.error}`
    : !state.data?.rows.length ? 'No data for these filters.'
    : null;
  return (
    <section className="chart-card">
      <h3>{title}</h3>
      {note && <p className="muted">{note}</p>}
      <div className="chart-area">
        {message ? <p className={`chart-msg ${state.error ? 'error' : ''}`}>{message}</p>
          : <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>}
      </div>
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
  return (
    <>
      <h2 className="section-heading">Patient Access Metrics</h2>
      <div className="chart-grid">
        <ChartCard title="SP/HUB Patients Initiating Therapy by Enrollment Month" note={KNOWN_SP_NOTE} state={init}>
          <BarChart data={init.data?.rows}><CartesianGrid vertical={false} stroke="#EDEDED" /><XAxis dataKey="label" tick={axis} /><YAxis tick={axis} tickFormatter={pctTick} domain={[0, 1]} /><Tooltip formatter={tooltip(init.data?.fields)} />
            <Bar dataKey="pct_initiate_therapy" name={measureLabel('pct_initiate_therapy')} fill={C.light} /></BarChart>
        </ChartCard>
        <Unavailable title="By Free Trial Month – % of Patients that Progress to SP Filled" note="Excludes FT ONLY & Known SP"
          reason="The backend has no definition yet for “Free Trial month” or “patients with an initial FT shipment”." />
        <ChartCard title="SP/HUB Patients – progression to SP shipments" note={KNOWN_SP_NOTE} state={prog}>
          <LineChart data={prog.data?.rows}><CartesianGrid vertical={false} stroke="#EDEDED" /><XAxis dataKey="label" tick={axis} /><YAxis tick={axis} tickFormatter={pctTick} domain={[0, 1]} /><Tooltip formatter={tooltip(prog.data?.fields)} /><Legend wrapperStyle={{ fontSize: 11 }} />
            <Line dataKey="pct_initiate_therapy" name="%_Initiate_Therapy" stroke={C.light} strokeWidth={2} dot={false} />
            <Line dataKey="pct_initiate_sp" name="%_Initiate_SP" stroke={C.navy} strokeWidth={2} dot={false} />
            <Line dataKey="pct_initiate_paid" name="%_Initiate_Paid" stroke={C.orange} strokeWidth={2} dot={false} /></LineChart>
        </ChartCard>
        <ChartCard title="% of SP/HUB Patients Initiating SP Therapy within 60 days of Enrollment"
          note={`Free Trial excluded; enrollments at least 60 days old (SP_Start_60d_include_rule = 1). ${KNOWN_SP_NOTE}`} state={sixty}>
          <BarChart data={sixty.data?.rows}><CartesianGrid vertical={false} stroke="#EDEDED" /><XAxis dataKey="label" tick={axis} /><YAxis tick={axis} tickFormatter={pctTick} domain={[0, 1]} /><Tooltip formatter={tooltip(sixty.data?.fields)} /><Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="pct_initiate_sp_excludes_ft" name="%_Initiate_SP_Excludes_FT" fill={C.light} />
            <Bar dataKey="pct_initiate_paid_exclude_ft" name="%_Initiate_Paid_Exclude_FT" fill={C.navy} /></BarChart>
        </ChartCard>
      </div>
    </>
  );
}

const DEMAND: { id: string; label: string; title: string; target?: number; measure?: string; basis?: DateBasis; basisLabel?: string; reason?: string }[] = [
  { id: 'npw', label: 'NBRx', title: 'New Patients Written (NBRx)', target: 526, measure: 'new_patients_written', basis: 'enrollment', basisLabel: 'By enrollment month' },
  { id: 'npf', label: 'NPF', title: 'New Patients Filled', target: 449, measure: 'new_patients_filled', basis: 'first_fill', basisLabel: 'By first fill month' },
  { id: 'pod', label: 'Patients on Drug', title: 'Total Patients on Drug', target: 426, reason: 'The backend has no patients-on-drug measure yet.' },
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
        {sel.measure ? (
          <ChartCard title={`${sel.title} – Monthly`} note={note} state={data}>
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

function Persistence() {
  return (
    <div className="chart-grid one">
      <Unavailable title="Discontinuation – Monthly Rate & Launch-Cohort Cumulative" note="Target: cumulative discontinuation below 13.7%"
        reason="The backend has no discontinuation or persistence measures yet." />
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
      <ChartCard title="NBRx by Status – Monthly" note="New patients written by enrollment month, split by current status" state={{ ...res, data: res.data && { rows } }}>
        <BarChart data={rows}><CartesianGrid vertical={false} stroke="#EDEDED" /><XAxis dataKey="label" tick={axis} /><YAxis tick={axis} /><Tooltip formatter={(v) => formatValue(v as Value, written)} /><Legend wrapperStyle={{ fontSize: 11 }} />
          {statuses.map((s, i) => (
            <Bar key={s} dataKey={(row: ChartRow) => row[s] ?? null} name={s} stackId="s" fill={STACK_COLORS[i % STACK_COLORS.length]} />
          ))}</BarChart>
      </ChartCard>
    </div>
  );
}

export function Charts() {
  const [section, setSection] = useState<Section>('Patient Access');
  const [selections, setSelections] = useState<Selections>({});
  const filters = toApiFilters(selections);
  const live = LIVE_SECTIONS.includes(section);
  const options = useFilterOptions(live ? SLICERS.map((s) => s.id) : [], filters);
  return (
    <div className="page charts">
      <nav className="sub-tabs" aria-label="Chart sections">
        {SECTIONS.map((s) => (
          <button key={s} type="button" aria-pressed={section === s} className={section === s ? 'on' : ''} onClick={() => setSection(s)}>{s}</button>
        ))}
      </nav>
      {live && (
        <div className="slicer-row">
          {SLICERS.map((s) => (
            <MultiSelect key={s.id} label={s.label} options={options.data?.[s.id] ?? []} loading={options.loading}
              value={selections[s.id] ?? []} onChange={(v) => setSelections({ ...selections, [s.id]: v })} />
          ))}
          {options.error && <p className="error">Couldn't load filter values: {options.error}</p>}
        </div>
      )}
      {section === 'Patient Access' && <PatientAccess filters={filters} />}
      {section === 'Demand Volume & Shipments' && <Demand filters={filters} />}
      {section === 'Persistence' && <Persistence />}
      {section === 'Reported Adherence' && <ReportedAdherence />}
      {section === 'Net Sales' && <NetSales />}
      {section === 'Patient Status' && <PatientStatus filters={filters} />}
    </div>
  );
}
