// Single source of truth for what the Insights Accelerator can show.
// Add a measure or field here and it appears in the UI automatically.

export type SourceId = 'sphub' | 'tpl' | 'atu';

export const SOURCES: { id: SourceId; label: string; detail: string }[] = [
  { id: 'sphub', label: 'SP/HUB', detail: 'Claritas patient-level data' },
  { id: 'tpl', label: '3PL', detail: 'Sales and shipments' },
  { id: 'atu', label: 'ATU Survey', detail: 'Patient and HCP reported' },
];

export type FieldGroup = 'Patient' | 'HCP' | 'Payer/Pharmacy' | 'Program' | 'Dates';

export interface Field {
  id: string;
  label: string;
  group: FieldGroup;
  sources: SourceId[]; // field is only shown when one of these sources is selected
}

export const FIELDS: Field[] = [
  { id: 'enrolling_hcp_area', label: 'Enrolling HCP Area', group: 'HCP', sources: ['sphub'] },
  { id: 'enrolling_hcp_city', label: 'Enrolling HCP City', group: 'HCP', sources: ['sphub'] },
  { id: 'enrolling_hcp_hco', label: 'Enrolling HCP HCO', group: 'HCP', sources: ['sphub'] },
  { id: 'enrolling_hcp_region', label: 'Enrolling HCP Region', group: 'HCP', sources: ['sphub'] },
  { id: 'enrolling_hcp_specialty', label: 'Enrolling HCP Specialty', group: 'HCP', sources: ['sphub'] },
  { id: 'enrolling_hcp_state', label: 'Enrolling HCP State', group: 'HCP', sources: ['sphub'] },
  { id: 'enrolling_hcp_territory', label: 'Enrolling HCP Territory', group: 'HCP', sources: ['sphub'] },
  { id: 'hco_priority', label: 'HCO Priority', group: 'HCP', sources: ['sphub'] },
  { id: 'current_status', label: 'Current Status', group: 'Patient', sources: ['sphub'] },
  { id: 'enrollment_pyr_typ', label: 'Payer Type', group: 'Payer/Pharmacy', sources: ['sphub'] },
  { id: 'prgrm_nm', label: 'Program Name', group: 'Program', sources: ['sphub'] },
  { id: 'enrollment_month', label: 'Enrollment Month', group: 'Dates', sources: ['sphub'] },
  { id: 'month', label: 'Month', group: 'Dates', sources: ['tpl', 'atu'] },
  { id: 'sku', label: 'SKU', group: 'Program', sources: ['tpl'] },
  { id: 'atu_wave', label: 'ATU Wave', group: 'Dates', sources: ['atu'] },
];

export type Format = 'count' | 'pct' | 'days' | 'usd' | 'ratio';

export interface Measure {
  id: string;
  label: string;
  source: SourceId;
  format: Format;
  definition: string;
  origin: 'Excel KPI list' | 'Existing Insights Accelerator';
}

export const MEASURES: Measure[] = [
  { id: 'npw', label: 'New patients written', source: 'sphub', format: 'count', definition: 'New prescriptions written (patients enrolled)', origin: 'Excel KPI list' },
  { id: 'npf', label: 'New patients filled', source: 'sphub', format: 'count', definition: 'New prescriptions filled, launch to date (first fill)', origin: 'Excel KPI list' },
  { id: 'ship', label: 'Total shipments', source: 'sphub', format: 'count', definition: 'Shipments to patients (definition to confirm)', origin: 'Existing Insights Accelerator' },
  { id: 'init', label: '% Initiated Therapy', source: 'sphub', format: 'pct', definition: '% of SP/HUB patients initiating therapy', origin: 'Existing Insights Accelerator' },
  { id: 'init_nft', label: '% Initiated not FT Therapy', source: 'sphub', format: 'pct', definition: '% of free-trial patients progressing to SP filled', origin: 'Existing Insights Accelerator' },
  { id: 'init_paid', label: '% Initiated Paid Therapy', source: 'sphub', format: 'pct', definition: '% of SP/HUB patients initiating paid therapy', origin: 'Existing Insights Accelerator' },
  { id: 'pod', label: 'Total patients on drug', source: 'sphub', format: 'count', definition: 'New + continuing patients not discontinued', origin: 'Excel KPI list' },
  { id: 'trx', label: 'TRx volume', source: 'sphub', format: 'count', definition: 'New + refill fills', origin: 'Excel KPI list' },
  { id: 'trx_pp', label: 'TRx per patient', source: 'sphub', format: 'ratio', definition: 'Units (std days supply) ÷ patients shipped', origin: 'Excel KPI list' },
  { id: 'persist', label: 'Persistence (cum. discontinuation)', source: 'sphub', format: 'pct', definition: 'Cumulative discontinuation, month 0–3 launch cohort', origin: 'Excel KPI list' },
  { id: 'disc', label: 'Discontinuation counts', source: 'sphub', format: 'count', definition: 'Patients discontinuing therapy', origin: 'Excel KPI list' },
  { id: 'dbf', label: 'Days between fill', source: 'sphub', format: 'days', definition: 'Average days between fills', origin: 'Excel KPI list' },
  { id: 'units', label: 'Units dispensed', source: 'tpl', format: 'count', definition: 'Units dispensed per SKU', origin: 'Excel KPI list' },
  { id: 'net_sales', label: 'Net sales', source: 'tpl', format: 'usd', definition: 'Revenue after GTN adjustments', origin: 'Excel KPI list' },
  { id: 'pt_adh', label: 'Patient reported adherence', source: 'atu', format: 'pct', definition: 'Patient ATU: “How often, if ever, do you miss a dose?”', origin: 'Excel KPI list' },
  { id: 'hcp_adh', label: 'HCP reported adherence', source: 'atu', format: 'pct', definition: 'HCP ATU: “How often, if ever, do patients miss a dose?”', origin: 'Excel KPI list' },
  { id: 'pt_persist', label: 'Patient reported persistence', source: 'atu', format: 'pct', definition: '% of patients starting and reporting remaining on therapy', origin: 'Excel KPI list' },
];

// Filter panels shown by the "Select Filters" buttons.
export const FILTER_GROUPS: { id: string; label: string; filters: { id: string; label: string; options: string[] }[] }[] = [
  {
    id: 'patient',
    label: 'Patient Attributes',
    filters: [
      { id: 'initiated_therapy', label: 'Initiated Therapy (SP)', options: ['Y', 'N'] },
      { id: 'initiated_paid_therapy', label: 'Initiated Paid Therapy (SP)', options: ['Y', 'N'] },
      { id: 'current_status', label: 'Current Status', options: ['Active - Paid', 'Active - FT', 'Pending', 'Discontinued'] },
      { id: 'current_sub_status', label: 'Current Sub Status', options: ['[Sub status A]', '[Sub status B]'] },
      { id: 'previous_targeted_therapy', label: 'Previous Targeted Therapy', options: ['Yes', 'None'] },
    ],
  },
  {
    id: 'hcp',
    label: 'HCP Attributes',
    filters: [
      { id: 'enrolling_hcp_territory', label: 'Enrolling HCP Territory', options: ['[Territory 01]', '[Territory 02]', '[Territory 03]'] },
      { id: 'enrolling_hcp_region', label: 'Enrolling HCP Region', options: ['[Region A]', '[Region B]'] },
      { id: 'hco_priority', label: 'HCO Priority', options: ['Priority 1', 'Priority 2', 'Priority 3', 'Non-Priority'] },
      { id: 'enrolling_hcp_trgt', label: 'Enrolling HCP Target', options: ['Target', 'Non-target'] },
    ],
  },
  {
    id: 'payer',
    label: 'Payer/Pharmacy Attributes',
    filters: [
      { id: 'enrollment_pyr_typ', label: 'Enrollment Payer Type', options: ['Commercial', 'Medicare', 'Medicaid', 'Other'] },
      { id: 'enrollment_pbm', label: 'Enrollment PBM', options: ['[PBM A]', '[PBM B]'] },
      { id: 'first_paid_sp', label: 'First Paid SP', options: ['[SP A]', '[SP B]'] },
    ],
  },
  {
    id: 'program',
    label: 'Program Attributes',
    filters: [
      { id: 'prgrm_nm', label: 'SP/HUB Program Type', options: ['Commercial', 'Free Trial', 'Commercial; Free Trial'] },
      { id: 'first_fill_shipment_type', label: 'First Fill Shipment Type', options: ['FT', 'Paid'] },
    ],
  },
  {
    id: 'dates',
    label: 'Dates',
    filters: [],
  },
];

export const DATE_FILTERS = ['Enrollment date', 'Latest status date', 'First fill date', 'First paid fill date'];
