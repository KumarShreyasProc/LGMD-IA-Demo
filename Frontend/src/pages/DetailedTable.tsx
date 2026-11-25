import { useEffect, useMemo, useState } from 'react';
import { DATE_FILTERS } from '../config/model';
import { getPatients, PATIENT_COLUMNS, type DateRange as Range, type Filters, type PatientRow } from '../data/api';
import { MultiSelect } from '../components/MultiSelect';
import { DateRange } from '../components/DateRange';
import { DataTable, downloadCsv } from '../components/DataTable';
import { Panel } from '../components/Panel';

const GROUPS: { title: string; filters: { id: string; label: string; options: string[] }[] }[] = [
  { title: 'Enrolling HCP', filters: [
    { id: 'enrolling_hcp_territory', label: 'enrolling_hcp_territory', options: ['[Territory 01]', '[Territory 02]', '[Territory 03]', '[Territory 04]'] },
    { id: 'enrolling_hcp_region', label: 'enrolling_hcp_region', options: ['[Region A]', '[Region B]', '[Region C]'] },
    { id: 'enrolling_hcp_area', label: 'enrolling_hcp_area', options: ['East', 'Central', 'West'] },
  ] },
  { title: 'Enrolling Payer', filters: [
    { id: 'enrollment_pyr_typ', label: 'enrollment_pyr_typ', options: ['Commercial', 'Medicare', 'Medicaid', 'Other'] },
    { id: 'enrollment_pbm', label: 'enrollment_pbm', options: ['[PBM A]', '[PBM B]'] },
  ] },
  { title: 'Flags', filters: [
    { id: 'current_status', label: 'current_status', options: ['Active - Paid', 'Active - FT', 'Pending', 'Discontinued'] },
    { id: 'initiated_therapy', label: 'initiated_therapy', options: ['Y', 'N'] },
    { id: 'initiated_paid_therapy', label: 'initiated_paid_therapy', options: ['Y', 'N'] },
    { id: 'first_fill_shipment_type', label: 'first_fill_shipment_type', options: ['FT', 'Paid'] },
  ] },
];

const DEFAULT_COLUMNS = PATIENT_COLUMNS.slice(0, 10);

export function DetailedTable() {
  const [showFilters, setShowFilters] = useState(true);
  const [showColumns, setShowColumns] = useState(false);
  const [filters, setFilters] = useState<Filters>({});
  const [dates, setDates] = useState<Record<string, Range>>({});
  const [patientId, setPatientId] = useState('');
  const [columns, setColumns] = useState<string[]>(DEFAULT_COLUMNS);
  const [rows, setRows] = useState<PatientRow[]>([]);

  useEffect(() => { getPatients(filters).then(setRows); }, [JSON.stringify(filters)]);

  const visible = useMemo(
    () => rows.filter((r) => !patientId || String(r.crx_ptnt_id).includes(patientId.trim())),
    [rows, patientId],
  );
  const tableRows = visible.map((r) => columns.map((c) => r[c] ?? ''));
  const written = visible.reduce((a, r) => a + Number(r['New Patients Written']), 0);
  const filled = visible.reduce((a, r) => a + Number(r['New Patients Filled']), 0);
  const total = columns.map((c, i) => (i === 0 ? 'Total' : c === 'New Patients Written' ? written : c === 'New Patients Filled' ? filled : ''));
  const activeCount = Object.values(filters).filter((v) => v.length).length + Object.values(dates).filter((r) => r.from || r.to).length + (patientId ? 1 : 0);

  return (
    <div className="page detail">
      <div className="toolbar">
        <button type="button" className="filter-btn" aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}>
          {showFilters ? 'Hide filters' : `Show filters${activeCount ? ` (${activeCount} applied)` : ''}`}
        </button>
        <button type="button" className="filter-btn" aria-expanded={showColumns} onClick={() => setShowColumns(!showColumns)}>
          Choose columns
        </button>
        <span className="spacer" />
        <button type="button" className="export" onClick={() => downloadCsv('patient-detail.csv', columns, tableRows)}>Export CSV</button>
      </div>

      {showColumns && (
        <Panel title="Columns" className="columns-panel">
          <div className="column-grid">
            {PATIENT_COLUMNS.map((c) => (
              <label key={c} className="check">
                <input type="checkbox" checked={columns.includes(c)}
                  onChange={() => setColumns(columns.includes(c) ? columns.filter((x) => x !== c) : PATIENT_COLUMNS.filter((x) => x === c || columns.includes(x)))} />
                {c}
              </label>
            ))}
          </div>
        </Panel>
      )}

      {showFilters && (
        <div className="detail-filters">
          <Panel title="Dates" className="span-2">
            <div className="filter-grid">
              {DATE_FILTERS.map((d) => (
                <DateRange key={d} label={d} value={dates[d] ?? { from: '', to: '' }} onChange={(r) => setDates({ ...dates, [d]: r })} />
              ))}
            </div>
          </Panel>
          {GROUPS.map((g) => (
            <Panel key={g.title} title={g.title}>
              <div className="filter-grid">
                {g.filters.map((f) => (
                  <MultiSelect key={f.id} label={f.label} options={f.options} value={filters[f.id] ?? []} onChange={(v) => setFilters({ ...filters, [f.id]: v })} />
                ))}
              </div>
            </Panel>
          ))}
          <Panel title="IDs">
            <label className="slicer">
              <span className="slicer-label">crx_ptnt_id</span>
              <input className="search" type="search" placeholder="Search patient ID" value={patientId} onChange={(e) => setPatientId(e.target.value)} />
            </label>
          </Panel>
        </div>
      )}

      {columns.length === 0 ? (
        <section className="empty"><p><strong>No columns selected.</strong> Use “Choose columns” to add some.</p></section>
      ) : visible.length === 0 ? (
        <section className="empty"><p><strong>No patients match these filters.</strong> Remove a filter to see results.</p></section>
      ) : (
        <DataTable columns={columns} rows={tableRows} total={total} numericFrom={99} pageSize={showFilters ? 8 : 18} />
      )}
    </div>
  );
}
