// Data access layer: every visual reads from the FastAPI backend under /api.
// URLs are relative, so the same build works locally and on Databricks Apps.
import { useEffect, useState } from 'react';

export type Value = string | number | boolean | null;
export type Row = Record<string, Value>;

/** Backend filter object keyed by dimension name: a list means IN (null = Blank), objects are operators. */
export type ApiFilters = Record<string, unknown>;
/** Slicer selections: dimension name → selected values (empty = All). */
export type Selections = Record<string, Value[]>;
export interface DateRange { from: string; to: string }
/** Date filters: date dimension name → range. */
export type DateRanges = Record<string, DateRange>;

export interface FieldMeta {
  name: string;
  label: string;
  type: 'measure' | 'dimension' | 'other';
  format?: string; // measures: number | percentage | timestamp; dimensions: string | number | date | timestamp
  decimals?: number;
}
export interface QueryResult { columns: string[]; fields: FieldMeta[]; rows: Row[] }
export interface KpiResult { values: Row; fields: FieldMeta[] }
export interface PatientsResult extends QueryResult { total: number; limit: number; offset: number }
export interface MeasureMeta { name: string; label: string; description: string; format: string; decimals: number }
export interface Meta { measures: MeasureMeta[] }
export type DateBasis = 'enrollment' | 'first_fill' | 'first_not_ft' | 'first_paid' | 'status_change';

async function request<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/${path}`, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data?.detail;
    throw new Error(typeof detail === 'string' ? detail : detail ? JSON.stringify(detail) : `Request failed (HTTP ${res.status})`);
  }
  // A non-JSON 200 is usually a sign-in page after the Databricks session expired.
  if (data === null) throw new Error('Unexpected response from the server. Reload the page and try again.');
  return data as T;
}

export const api = {
  meta: () => request<Meta>('meta'),
  query: (body: { measures: string[]; dimensions: string[]; filters: ApiFilters; order_by?: string[]; limit?: number }) =>
    request<QueryResult>('query', body),
  kpis: (measures: string[], filters: ApiFilters = {}) => request<KpiResult>('kpis', { measures, filters }),
  trend: (body: { date_basis: DateBasis; grain: 'month'; measures: string[]; filters: ApiFilters }) =>
    request<QueryResult>('trend', body),
  patients: (body: { columns: string[]; filters: ApiFilters; limit: number }) => request<PatientsResult>('patients', body),
  filterOptions: (dimensions: string[], filters: ApiFilters) =>
    request<{ options: Record<string, Value[]> }>('filter-options', { dimensions, filters }).then((r) => r.options),
};

/** Slicer selections + date ranges → backend filter object (empty selections are left out). */
export function toApiFilters(selections: Selections, dates: DateRanges = {}): ApiFilters {
  const out: ApiFilters = {};
  for (const [dim, values] of Object.entries(selections)) if (values.length) out[dim] = values;
  for (const [dim, r] of Object.entries(dates)) if (r.from || r.to) out[dim] = { between: [r.from || null, r.to || null] };
  return out;
}

export const byName = (fields: FieldMeta[] = []): Record<string, FieldMeta> =>
  Object.fromEntries(fields.map((f) => [f.name, f]));

/** Formats a value with the backend's field metadata (percentages arrive as fractions). */
export function formatValue(value: Value | undefined, field?: FieldMeta): string {
  if (value === null || value === undefined) return field?.type === 'measure' ? '' : '(Blank)';
  const decimals = field?.decimals ?? 0;
  const digits = { minimumFractionDigits: decimals, maximumFractionDigits: decimals };
  switch (field?.format) {
    case 'percentage':
      return new Intl.NumberFormat(undefined, { style: 'percent', ...digits }).format(Number(value));
    case 'number': // only measures get separators; number dimensions (e.g. year of birth) stay as-is
      return field.type === 'measure' ? new Intl.NumberFormat(undefined, digits).format(Number(value)) : String(value);
    case 'timestamp': {
      const d = new Date(String(value));
      return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
    }
    default:
      return String(value);
  }
}

export interface Loadable<T> { data?: T; error?: string; loading: boolean }

/**
 * Loads data whenever `key` changes (`null` = nothing to load). Responses for an
 * older key are ignored, so fast filter changes never show stale results.
 */
export function useApi<T>(key: string | null, load: () => Promise<T>): Loadable<T> {
  const [result, setResult] = useState<{ key: string; data?: T; error?: string }>();
  useEffect(() => {
    if (key === null) return;
    let current = true;
    load().then(
      (data) => { if (current) setResult({ key, data }); },
      (err: unknown) => { if (current) setResult({ key, error: err instanceof Error ? err.message : String(err) }); },
    );
    return () => { current = false; };
  }, [key]);
  if (key === null) return { loading: false };
  if (result?.key !== key) return { loading: true };
  return { data: result.data, error: result.error, loading: false };
}

/** Slicer values from /api/filter-options; each slicer respects the other active filters. */
export function useFilterOptions(dimensions: string[], filters: ApiFilters) {
  const key = dimensions.length ? JSON.stringify(['filter-options', dimensions, filters]) : null;
  return useApi(key, () => api.filterOptions(dimensions, filters));
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
