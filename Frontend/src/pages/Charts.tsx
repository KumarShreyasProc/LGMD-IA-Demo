import { useEffect, useState, type ReactNode } from 'react';
import {
  Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { getSeries, type SeriesPoint } from '../data/api';
import { MultiSelect } from '../components/MultiSelect';

const C = { light: '#118DFF', navy: '#12239E', orange: '#E66C37', grey: '#A19F9D', pale: '#A9C9F0' };
const SECTIONS = ['Patient Access', 'Demand Volume & Shipments', 'Persistence', 'Reported Adherence', 'Net Sales', 'Patient Status'] as const;
type Section = (typeof SECTIONS)[number];

function useSeries(id: string, names: string[], scale = 100, points = 18) {
  const [data, setData] = useState<SeriesPoint[]>([]);
  useEffect(() => { getSeries(id, names, points, scale).then(setData); }, [id, names.join(), scale, points]);
  return data;
}

function ChartCard({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="chart-card">
      <h3>{title}</h3>
      {note && <p className="muted">{note}</p>}
      <div className="chart-area">
        <ResponsiveContainer width="100%" height="100%">{children as any}</ResponsiveContainer>
      </div>
    </section>
  );
}

const pct = (v: number) => `${v}%`;
const axis = { fontSize: 11, fill: '#605E5C' };

function PatientAccess() {
  const [program, setProgram] = useState<string[]>([]);
  const [payer, setPayer] = useState<string[]>([]);
  const key = program.join() + payer.join();
  const init = useSeries('init' + key, ['% Initiated Therapy'], 80);
  const ft = useSeries('ft' + key, ['Patients with Initial FT Shipment', 'Patients with subsequent SP Filled', '% Initiated_not_FT'], 120);
  const prog = useSeries('prog' + key, ['%_Initiate_Therapy', '%_Initiate_SP', '%_Initiate_Paid'], 75);
  const sixty = useSeries('sixty' + key, ['%_Initiate_SP', '%_Initiate_Paid'], 70);
  return (
    <>
      <div className="slicer-row">
        <MultiSelect label="SP/HUB Program Type (prgrm_nm)" options={['Commercial', 'Free Trial', 'Commercial; Free Trial']} value={program} onChange={setProgram} />
        <MultiSelect label="Enrollment Payer Type (enrollment_pyr_typ)" options={['Commercial', 'Medicare', 'Medicaid', 'Other']} value={payer} onChange={setPayer} />
      </div>
      <h2 className="section-heading">Patient Access Metrics</h2>
      <div className="chart-grid">
        <ChartCard title="SP/HUB Patients Initiating Therapy by Enrollment Month" note="Excludes Known SP">
          <BarChart data={init}><CartesianGrid vertical={false} stroke="#EDEDED" /><XAxis dataKey="label" tick={axis} /><YAxis tick={axis} tickFormatter={pct} domain={[0, 100]} /><Tooltip formatter={(v) => pct(Number(v))} /><Bar dataKey="% Initiated Therapy" fill={C.light} /></BarChart>
        </ChartCard>
        <ChartCard title="By Free Trial Month – % of Patients that Progress to SP Filled" note="Excludes FT ONLY & Known SP">
          <ComposedChart data={ft}><CartesianGrid vertical={false} stroke="#EDEDED" /><XAxis dataKey="label" tick={axis} /><YAxis yAxisId="n" tick={axis} /><YAxis yAxisId="p" orientation="right" tick={axis} tickFormatter={pct} /><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="n" dataKey="Patients with Initial FT Shipment" fill={C.light} /><Bar yAxisId="n" dataKey="Patients with subsequent SP Filled" fill={C.navy} /><Line yAxisId="p" dataKey="% Initiated_not_FT" stroke={C.orange} strokeWidth={2} dot={false} /></ComposedChart>
        </ChartCard>
        <ChartCard title="SP/HUB Patients – progression to SP shipments" note="Excludes Known SP">
          <LineChart data={prog}><CartesianGrid vertical={false} stroke="#EDEDED" /><XAxis dataKey="label" tick={axis} /><YAxis tick={axis} tickFormatter={pct} domain={[0, 100]} /><Tooltip formatter={(v) => pct(Number(v))} /><Legend wrapperStyle={{ fontSize: 11 }} />
            <Line dataKey="%_Initiate_Therapy" stroke={C.light} strokeWidth={2} dot={false} /><Line dataKey="%_Initiate_SP" stroke={C.navy} strokeWidth={2} dot={false} /><Line dataKey="%_Initiate_Paid" stroke={C.orange} strokeWidth={2} dot={false} /></LineChart>
        </ChartCard>
        <ChartCard title="% of SP/HUB Patients Initiating SP Therapy within 60 days of Enrollment" note="Excludes FT ONLY & Known SP">
          <BarChart data={sixty}><CartesianGrid vertical={false} stroke="#EDEDED" /><XAxis dataKey="label" tick={axis} /><YAxis tick={axis} tickFormatter={pct} domain={[0, 100]} /><Tooltip formatter={(v) => pct(Number(v))} /><Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="%_Initiate_SP" fill={C.light} /><Bar dataKey="%_Initiate_Paid" fill={C.navy} /></BarChart>
        </ChartCard>
      </div>
    </>
  );
}

const DEMAND = [
  { id: 'npw', label: 'NBRx', title: 'New Patients Written (NBRx)', target: 526 },
  { id: 'npf', label: 'NPF', title: 'New Patients Filled', target: 449 },
  { id: 'pod', label: 'Patients on Drug', title: 'Total Patients on Drug', target: 426 },
  { id: 'trx', label: 'TRx', title: 'TRx Volume – Monthly Fills' },
  { id: 'units', label: 'Units', title: 'Units Dispensed – Monthly', target: 2776 },
  { id: 'ship', label: 'Total Shipments', title: 'Total Shipments' },
];

function Demand() {
  const [sel, setSel] = useState(DEMAND[0]);
  const data = useSeries('demand' + sel.id, ['Actual'], sel.id === 'units' ? 250 : 40, 12);
  return (
    <>
      <div className="segmented" role="group" aria-label="Select measure">
        {DEMAND.map((d) => (
          <button key={d.id} type="button" aria-pressed={sel.id === d.id} className={sel.id === d.id ? 'on' : ''} onClick={() => setSel(d)}>{d.label}</button>
        ))}
      </div>
      <div className="chart-grid one">
        <ChartCard title={`${sel.title} – Monthly`} note={sel.target ? `2027 YE target: ${sel.target.toLocaleString()}` : 'Existing Insights Accelerator measure'}>
          <BarChart data={data}><CartesianGrid vertical={false} stroke="#EDEDED" /><XAxis dataKey="label" tick={axis} /><YAxis tick={axis} /><Tooltip /><Bar dataKey="Actual" fill={C.light} /></BarChart>
        </ChartCard>
      </div>
    </>
  );
}

function Persistence() {
  const data = useSeries('persist', ['% discontinuation per month', 'Cumulative discontinuation (M0–3 cohort)'], 12, 12);
  return (
    <div className="chart-grid one">
      <ChartCard title="Discontinuation – Monthly Rate & Launch-Cohort Cumulative" note="Target: cumulative discontinuation below 13.7%">
        <ComposedChart data={data}><CartesianGrid vertical={false} stroke="#EDEDED" /><XAxis dataKey="label" tick={axis} /><YAxis tick={axis} tickFormatter={pct} /><Tooltip formatter={(v) => pct(Number(v))} /><Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="% discontinuation per month" fill={C.light} /><Line dataKey="Cumulative discontinuation (M0–3 cohort)" stroke={C.navy} strokeWidth={2} dot={false} />
          <ReferenceLine y={13.7} stroke={C.orange} strokeDasharray="6 4" label={{ value: 'Target 13.7%', fontSize: 11, fill: C.orange, position: 'insideTopRight' }} /></ComposedChart>
      </ChartCard>
    </div>
  );
}

function ReportedAdherence() {
  const waves = [
    { label: '[Wave 1]', '[Response 1]': 50, '[Response 2]': 30, '[Response 3]': 12, '[Response 4]': 8 },
    { label: '[Wave 2]', '[Response 1]': 58, '[Response 2]': 26, '[Response 3]': 10, '[Response 4]': 6 },
  ];
  return (
    <div className="chart-grid">
      <ChartCard title="Patient Reported Adherence – by ATU Wave" note="“How often, if ever, do you miss a dose?”">
        <BarChart data={waves}><XAxis dataKey="label" tick={axis} /><YAxis tick={axis} tickFormatter={pct} /><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
          {['[Response 1]', '[Response 2]', '[Response 3]', '[Response 4]'].map((r, i) => <Bar key={r} dataKey={r} stackId="a" fill={[C.navy, C.light, C.pale, C.orange][i]} />)}</BarChart>
      </ChartCard>
      <ChartCard title="Patient Reported Persistence – by ATU Wave" note="% of patients starting and reporting remaining on therapy">
        <BarChart data={[{ label: '[Wave 1]', value: 72 }, { label: '[Wave 2]', value: 78 }]}><XAxis dataKey="label" tick={axis} /><YAxis tick={axis} tickFormatter={pct} domain={[0, 100]} /><Tooltip /><Bar dataKey="value" name="Reported persistence" fill={C.navy} /></BarChart>
      </ChartCard>
    </div>
  );
}

function NetSales() {
  const data = useSeries('sales', ['Actual', 'Forecast'], 9, 12);
  return (
    <div className="chart-grid one">
      <ChartCard title="Net Sales – Actual vs Forecast, Monthly ($M)" note="2027 YE target: $114M · after GTN adjustments">
        <ComposedChart data={data}><CartesianGrid vertical={false} stroke="#EDEDED" /><XAxis dataKey="label" tick={axis} /><YAxis tick={axis} tickFormatter={(v) => `$${v}M`} /><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="Actual" fill={C.light} /><Line dataKey="Forecast" stroke={C.orange} strokeDasharray="6 4" strokeWidth={2} dot={false} /></ComposedChart>
      </ChartCard>
    </div>
  );
}

function PatientStatus() {
  const data = useSeries('status', ['Filled', 'Pending', 'Discontinued'], 20, 12);
  return (
    <div className="chart-grid one">
      <ChartCard title="NBRx by Status – Monthly" note="Pending · Filled · Discontinued">
        <BarChart data={data}><CartesianGrid vertical={false} stroke="#EDEDED" /><XAxis dataKey="label" tick={axis} /><YAxis tick={axis} /><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="Filled" stackId="s" fill={C.navy} /><Bar dataKey="Pending" stackId="s" fill={C.light} /><Bar dataKey="Discontinued" stackId="s" fill={C.orange} /></BarChart>
      </ChartCard>
    </div>
  );
}

export function Charts() {
  const [section, setSection] = useState<Section>('Patient Access');
  return (
    <div className="page charts">
      <nav className="sub-tabs" aria-label="Chart sections">
        {SECTIONS.map((s) => (
          <button key={s} type="button" aria-pressed={section === s} className={section === s ? 'on' : ''} onClick={() => setSection(s)}>{s}</button>
        ))}
      </nav>
      {section === 'Patient Access' && <PatientAccess />}
      {section === 'Demand Volume & Shipments' && <Demand />}
      {section === 'Persistence' && <Persistence />}
      {section === 'Reported Adherence' && <ReportedAdherence />}
      {section === 'Net Sales' && <NetSales />}
      {section === 'Patient Status' && <PatientStatus />}
    </div>
  );
}
