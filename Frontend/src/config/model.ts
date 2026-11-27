// Single source of truth for what the Insights Accelerator offers.
// `id` is the backend's dimension/measure name (see GET /api/meta).
// `live: false` = part of the dashboard design, but the backend has no data for it yet;
// the UI shows it as "not available yet" instead of inventing numbers.

export type SourceId = 'sphub' | 'tpl' | 'atu';

export const SOURCES: { id: SourceId; label: string; detail: string }[] = [
  { id: 'sphub', label: 'SP/HUB', detail: 'Claritas patient-level data' },
  { id: 'tpl', label: '3PL', detail: 'Sales and shipments' },
  { id: 'atu', label: 'ATU Survey', detail: 'Patient and HCP reported' },
];

export interface Field {
  id: string;
  label: string;
  sources: SourceId[]; // field is only shown when one of these sources is selected
  live: boolean;
}

const sphubField = (id: string, label: string): Field => ({ id, label, sources: ['sphub'], live: true });

export const FIELDS: Field[] = [
  sphubField('src_table', 'Source Table'),
  sphubField('enrolling_hcp_area', 'Enrolling HCP Area'),
  sphubField('enrolling_hcp_city', 'Enrolling HCP City'),
  sphubField('enrolling_hcp_hco', 'Enrolling HCP HCO'),
  sphubField('enrolling_hcp_region', 'Enrolling HCP Region'),
  sphubField('enrolling_hcp_specialty', 'Enrolling HCP Specialty'),
  sphubField('enrolling_hcp_state', 'Enrolling HCP State'),
  sphubField('enrolling_hcp_territory', 'Enrolling HCP Territory'),
  sphubField('enrolling_hcp_priority', 'Enrolling HCP Priority'),
  sphubField('current_status', 'Current Status'),
  sphubField('enrollment_pyr_typ', 'Payer Type'),
  sphubField('prgrm_nm', 'Program Name'),
  sphubField('enrollment_month', 'Enrollment Month'),
  { id: 'month', label: 'Month', sources: ['tpl', 'atu'], live: false },
  { id: 'sku', label: 'SKU', sources: ['tpl'], live: false },
  { id: 'atu_wave', label: 'ATU Wave', sources: ['atu'], live: false },
];

export interface Measure {
  id: string;
  label: string;
  source: SourceId;
  live: boolean;
  definition?: string; // planned definition for measures that are not live (live ones come from /api/meta)
}

const liveMeasure = (id: string, label: string): Measure => ({ id, label, source: 'sphub', live: true });
const planned = (id: string, label: string, source: SourceId, definition: string): Measure =>
  ({ id, label, source, live: false, definition });

export const MEASURES: Measure[] = [
  liveMeasure('new_patients_written', 'New patients written'),
  liveMeasure('new_patients_filled', 'New patients filled'),
  liveMeasure('total_shipments', 'Total shipments'),
  liveMeasure('pct_initiate_therapy', '% Initiated Therapy'),
  liveMeasure('pct_initiated_not_ft', '% Initiated not FT Therapy'),
  liveMeasure('pct_initiate_sp', '% Initiated SP Therapy'),
  liveMeasure('pct_initiate_paid', '% Initiated Paid Therapy'),
  liveMeasure('pct_initiate_sp_excludes_ft', '% Initiated SP Therapy (excl. Free Trial)'),
  liveMeasure('pct_initiate_paid_exclude_ft', '% Initiated Paid Therapy (excl. Free Trial)'),
  liveMeasure('patients_on_drug', 'Total patients on drug'),
  planned('trx', 'TRx volume', 'sphub', 'New + refill fills'),
  liveMeasure('trx_per_patient', 'TRx per patient'),
  liveMeasure('pct_discontinued', 'Persistence (cum. discontinuation)'),
  liveMeasure('discontinued_patients', 'Discontinuation counts'),
  liveMeasure('avg_days_between_fills', 'Days between fill'),
  planned('units', 'Units dispensed', 'tpl', 'Units dispensed per SKU'),
  planned('net_sales', 'Net sales', 'tpl', 'Revenue after GTN adjustments'),
  planned('pt_adh', 'Patient reported adherence', 'atu', 'Patient ATU: “How often, if ever, do you miss a dose?”'),
  planned('hcp_adh', 'HCP reported adherence', 'atu', 'HCP ATU: “How often, if ever, do patients miss a dose?”'),
  planned('pt_persist', 'Patient reported persistence', 'atu', '% of patients starting and reporting remaining on therapy'),
];

export interface FilterDef { id: string; label: string }

// Filter panels shown by the "Select Filters" buttons. Values come from /api/filter-options.
export const FILTER_GROUPS: { id: string; label: string; filters: FilterDef[] }[] = [
  {
    id: 'patient',
    label: 'Patient Attributes',
    filters: [
      { id: 'initiated_therapy', label: 'Initiated Therapy (SP)' },
      { id: 'initiated_paid_therapy', label: 'Initiated Paid Therapy (SP)' },
      { id: 'current_status', label: 'Current Status' },
      { id: 'current_sub_status', label: 'Current Sub Status' },
      { id: 'previous_targeted_therapy', label: 'Previous Targeted Therapy' },
    ],
  },
  {
    id: 'hcp',
    label: 'HCP Attributes',
    filters: [
      { id: 'enrolling_hcp_territory', label: 'Enrolling HCP Territory' },
      { id: 'enrolling_hcp_region', label: 'Enrolling HCP Region' },
      { id: 'enrolling_hcp_priority', label: 'Enrolling HCP Priority' },
      { id: 'enrolling_hcp_trgt', label: 'Enrolling HCP Target' },
    ],
  },
  {
    id: 'payer',
    label: 'Payer/Pharmacy Attributes',
    filters: [
      { id: 'enrollment_pyr_typ', label: 'Enrollment Payer Type' },
      { id: 'enrollment_pbm', label: 'Enrollment PBM' },
      { id: 'first_paid_sp', label: 'First Paid SP' },
    ],
  },
  {
    id: 'program',
    label: 'Program Attributes',
    filters: [
      { id: 'prgrm_nm', label: 'SP/HUB Program Type' },
      { id: 'first_fill_shipment_type', label: 'First Fill Shipment Type' },
    ],
  },
  { id: 'dates', label: 'Dates', filters: [] },
];

export const DATE_FILTERS: FilterDef[] = [
  { id: 'enrollment_date', label: 'Enrollment date' },
  { id: 'latest_status_date', label: 'Latest status date' },
  { id: 'first_fill_date', label: 'First fill date' },
  { id: 'first_paid_fill_date', label: 'First paid fill date' },
];

// Slicers on the Detailed Table View page (labels are the Power BI column names).
export const DETAIL_FILTER_GROUPS: { title: string; filters: string[] }[] = [
  { title: 'Enrolling HCP', filters: ['enrolling_hcp_territory', 'enrolling_hcp_region', 'enrolling_hcp_area'] },
  { title: 'Enrolling Payer', filters: ['enrollment_pyr_typ', 'enrollment_pbm'] },
  { title: 'Flags', filters: ['current_status', 'initiated_therapy', 'initiated_paid_therapy', 'first_fill_shipment_type'] },
];

// Slicers on the Charts page (applied to every chart in the live sections).
export const CHART_FILTERS: FilterDef[] = [
  { id: 'prgrm_nm', label: 'SP/HUB Program Type (prgrm_nm)' },
  { id: 'enrollment_pyr_typ', label: 'Enrollment Payer Type (enrollment_pyr_typ)' },
];

/** Search box on the Detailed Table View page (crx_ptnt_id contains …). */
export const PATIENT_ID_FILTER = 'crx_ptnt_id';

// Filter selections are shared by all pages (like synced slicers), but each page only
// applies the filters it has a slicer for.
export type PageId = 'summary' | 'detail' | 'charts';
export const PAGE_FILTERS: Record<PageId, string[]> = {
  summary: [...FILTER_GROUPS.flatMap((g) => g.filters.map((f) => f.id)), ...DATE_FILTERS.map((d) => d.id)],
  detail: [...DETAIL_FILTER_GROUPS.flatMap((g) => g.filters), ...DATE_FILTERS.map((d) => d.id), PATIENT_ID_FILTER],
  charts: CHART_FILTERS.map((f) => f.id),
};

const FILTER_LABELS = new Map([
  ...[...FILTER_GROUPS.flatMap((g) => g.filters), ...DATE_FILTERS].map((f): [string, string] => [f.id, f.label]),
  [PATIENT_ID_FILTER, 'Patient ID'],
]);

export const fieldLabel = (id: string) => FIELDS.find((f) => f.id === id)?.label ?? id;
export const measureLabel = (id: string) => MEASURES.find((m) => m.id === id)?.label ?? id;
export const filterLabel = (id: string) => FILTER_LABELS.get(id) ?? fieldLabel(id);
