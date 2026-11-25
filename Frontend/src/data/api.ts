// Data access layer.
// USE_SAMPLE_DATA = true  → the UI runs on generated sample data (no Databricks needed).
// USE_SAMPLE_DATA = false → calls your backend routes in server.js, which query the SQL warehouse.
import { FIELDS, MEASURES, type Measure } from '../config/model';

export const USE_SAMPLE_DATA = true;

export type Filters = Record<string, string[]>;
export interface DateRange { from: string; to: string }

// Deterministic pseudo-random so sample numbers don't jump on every render.
function seeded(seed: number) {
  let s = seed % 2147483647;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const SAMPLE_VALUES: Record<string, string[]> = {
  enrolling_hcp_area: ['East', 'Central', 'West'],
  enrolling_hcp_city: ['New York', 'Boston', 'Atlanta', 'Houston', 'Chicago', 'Los Angeles'],
  enrolling_hcp_hco: ['[HCO 01]', '[HCO 02]', '[HCO 03]', '[HCO 04]', '[HCO 05]'],
  enrolling_hcp_region: ['[Region A]', '[Region B]', '[Region C]'],
  enrolling_hcp_specialty: ['Neurology', 'Neuromuscular', 'Genetics', 'Pediatrics'],
  enrolling_hcp_state: ['NY', 'MA', 'GA', 'TX', 'IL', 'CA'],
  enrolling_hcp_territory: ['[Territory 01]', '[Territory 02]', '[Territory 03]', '[Territory 04]'],
  hco_priority: ['Priority 1', 'Priority 2', 'Priority 3', 'Non-Priority'],
  current_status: ['Active - Paid', 'Active - FT', 'Pending', 'Discontinued'],
  enrollment_pyr_typ: ['Commercial', 'Medicare', 'Medicaid', 'Other'],
  prgrm_nm: ['Commercial', 'Free Trial', 'Commercial; Free Trial'],
  enrollment_month: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
  month: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
  sku: ['[SKU A]', '[SKU B]'],
  atu_wave: ['[Wave 1]', '[Wave 2]'],
};

function sampleValue(m: Measure, rand: () => number) {
  switch (m.format) {
    case 'pct': return 40 + rand() * 55;
    case 'days': return 5 + rand() * 40;
    case 'usd': return 50_000 + rand() * 900_000;
    case 'ratio': return 1 + rand() * 3;
    default: return Math.round(5 + rand() * 300);
  }
}

export interface SummaryRow { keys: string[]; values: number[] }

/** Result table for the Summary page: selected fields (rows) × selected measures (columns). */
export async function getSummary(fieldIds: string[], measureIds: string[], filters: Filters): Promise<SummaryRow[]> {
  if (!USE_SAMPLE_DATA) {
    const res = await fetch('/api/summary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fieldIds, measureIds, filters }) });
    return res.json();
  }
  const measures = measureIds.map((id) => MEASURES.find((m) => m.id === id)!);
  const lists = fieldIds.map((id) => SAMPLE_VALUES[id] ?? ['[Value]']);
  // Cartesian product of the selected field values (capped for readability)
  let combos: string[][] = [[]];
  for (const list of lists) combos = combos.flatMap((c) => list.map((v) => [...c, v])).slice(0, 40);
  const rand = seeded(fieldIds.join('').length * 97 + measureIds.join('').length * 31 + Object.keys(filters).length * 7 + 1);
  return combos.map((keys) => ({ keys, values: measures.map((m) => sampleValue(m, rand)) }));
}

export interface PatientRow { [col: string]: string | number }

export const PATIENT_COLUMNS = [
  'Source', 'New Patients Written', 'New Patients Filled', 'crx_ptnt_id', 'Patient Gender', 'Patient Year of Birth',
  'Patient State', 'Latest_SP_ptnt_id', 'previous_targeted_therapy', 'current_status', 'initiated_therapy',
  'initiated_paid_therapy', 'first_fill_shipment_type', 'enrolling_hcp_territory',
];

/** Patient-level rows for the Detailed Table View. */
export async function getPatients(filters: Filters): Promise<PatientRow[]> {
  if (!USE_SAMPLE_DATA) {
    const res = await fetch('/api/patients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filters }) });
    return res.json();
  }
  const rand = seeded(42);
  const statuses = SAMPLE_VALUES.current_status;
  const rows: PatientRow[] = Array.from({ length: 240 }, (_, i) => {
    const status = statuses[Math.floor(rand() * statuses.length)];
    const filled = status !== 'Pending';
    return {
      Source: 'SP/HUB',
      'New Patients Written': 1,
      'New Patients Filled': filled ? 1 : 0,
      crx_ptnt_id: `ptnt_${(100000 + i * 7919).toString(16)}`,
      'Patient Gender': rand() > 0.5 ? 'M' : 'F',
      'Patient Year of Birth': 1940 + Math.floor(rand() * 60),
      'Patient State': SAMPLE_VALUES.enrolling_hcp_state[Math.floor(rand() * 6)],
      Latest_SP_ptnt_id: filled ? String(5000100000 + i) : '',
      previous_targeted_therapy: rand() > 0.7 ? 'Yes' : 'None',
      current_status: status,
      initiated_therapy: filled ? 'Y' : 'N',
      initiated_paid_therapy: status === 'Active - Paid' ? 'Y' : 'N',
      first_fill_shipment_type: filled ? (status === 'Active - FT' ? 'FT' : 'Paid') : '',
      enrolling_hcp_territory: SAMPLE_VALUES.enrolling_hcp_territory[Math.floor(rand() * 4)],
    };
  });
  // Apply any column filters that match patient columns
  return rows.filter((r) => Object.entries(filters).every(([k, vals]) => !vals.length || !(k in r) || vals.includes(String(r[k]))));
}

export interface SeriesPoint { label: string; [series: string]: string | number }

/** Monthly series for the Charts pages. */
export async function getSeries(chartId: string, seriesNames: string[], points = 18, scale = 100): Promise<SeriesPoint[]> {
  if (!USE_SAMPLE_DATA) {
    const res = await fetch(`/api/series/${chartId}`);
    return res.json();
  }
  const rand = seeded(chartId.length * 131 + seriesNames.length);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return Array.from({ length: points }, (_, i) => {
    const p: SeriesPoint = { label: `${months[i % 12]} ${25 + Math.floor(i / 12)}` };
    seriesNames.forEach((s, j) => {
      const base = scale * (0.55 + 0.08 * j) + (scale * 0.25 * i) / points;
      p[s] = Math.round((base * (0.85 + rand() * 0.3)) * 10) / 10;
    });
    return p;
  });
}

export function fieldLabel(id: string) {
  return FIELDS.find((f) => f.id === id)?.label ?? id;
}

export function formatValue(v: number, format: Measure['format']) {
  switch (format) {
    case 'pct': return `${v.toFixed(1)}%`;
    case 'days': return `${v.toFixed(1)} d`;
    case 'usd': return `$${Math.round(v).toLocaleString()}`;
    case 'ratio': return v.toFixed(2);
    default: return Math.round(v).toLocaleString();
  }
}
