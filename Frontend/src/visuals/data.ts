// Loads and shapes the data for a (possibly personalized) visual.
// Every number, including subtotals and totals, comes from its own /api/query grouping:
// ratios are never summed or averaged in the browser.
import {
  api, byName, formatValue, useApi, useMeta,
  type ApiFilters, type DimensionMeta, type FieldMeta, type Loadable, type QueryResult, type Row, type Value,
} from '../data/api';
import { useFilters } from '../state/filters';
import { againstMeta, isChart, isPie, makeLabeler, normalize, visualTitle, type VisualConfig } from './config';

export const ROW_LIMIT = 5000;   // per query
export const MAX_COLUMNS = 25;   // matrix columns shown
export const MAX_SERIES = 8;     // chart series / pie slices shown (one color each)

export interface VisualData {
  config: VisualConfig;
  fields: Record<string, FieldMeta>;
  leaf: Row[];               // grouped by rows + column
  levels: Row[][];           // matrix: levels[k] grouped by rows[0..k] (+ column); otherwise [leaf]
  rowTotals: Row[][];        // with a column: same levels without the column
  columnTotals: Row[];       // with a column: grouped by the column only
  grand?: Row;               // table / matrix: no dimensions
  columnValues: Value[];     // column values shown (top N by the first value), in display order
  columnCount: number;       // all column values
  truncated: boolean;
}

const isDateDim = (name: string, dims: Map<string, DimensionMeta>) => dims.get(name)?.kind === 'date';

/** Blanks first, numbers numerically, text naturally (Power BI's ascending order). */
export function compareValues(a: Value, b: Value) {
  if (a === null || b === null) return a === b ? 0 : a === null ? -1 : 1;
  return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true });
}

function useVisualData(config: VisualConfig | null, filters: ApiFilters, dims: Map<string, DimensionMeta>): Loadable<VisualData> {
  const plan = config && buildPlan(config, filters, dims);
  const res = useApi(plan ? JSON.stringify(plan) : null, async () => {
    const run = (q: Query | null) => (q ? api.query(q) : Promise.resolve(null));
    const [levels, rowTotals, columnTotals, grand] = await Promise.all([
      Promise.all(plan!.levels.map(run)), Promise.all(plan!.rowTotals.map(run)), run(plan!.columnTotals), run(plan!.grand),
    ]);
    return { levels: levels as QueryResult[], rowTotals: rowTotals as QueryResult[], columnTotals, grand };
  });
  if (!config || !res.data) return { loading: res.loading, error: res.error };

  const { levels, rowTotals, columnTotals, grand } = res.data;
  const all = [...levels, ...rowTotals, columnTotals, grand].filter((r): r is QueryResult => r !== null);
  const fields = Object.assign({}, ...all.map((r) => byName(r.fields))) as Record<string, FieldMeta>;
  const first = config.values[0];
  const ranked = [...(columnTotals?.rows ?? [])].sort((a, b) => Number(b[first] ?? -Infinity) - Number(a[first] ?? -Infinity));
  const shown = ranked.slice(0, isChart(config.type) ? MAX_SERIES : MAX_COLUMNS).map((r) => r[config.columns!] ?? null);
  return {
    loading: false,
    data: {
      config,
      fields,
      leaf: levels[levels.length - 1].rows,
      levels: levels.map((r) => r.rows),
      rowTotals: rowTotals.map((r) => r.rows),
      columnTotals: columnTotals?.rows ?? [],
      grand: grand?.rows[0],
      columnValues: shown.sort(compareValues),
      columnCount: ranked.length,
      truncated: all.some((r) => r.rows.length >= ROW_LIMIT),
    },
  };
}

interface Query { measures: string[]; dimensions: string[]; filters: ApiFilters; order_by?: string[]; limit?: number }

export function buildPlan(config: VisualConfig, filters: ApiFilters, dims: Map<string, DimensionMeta>) {
  const { type, rows, columns, values } = config;
  const byValue = [`-${values[0]}`];
  // Date axes read left to right; everything else largest first (the row limit keeps the largest).
  const axisOrder = isDateDim(rows[0], dims) && type !== 'matrix' && !isPie(type) ? rows : byValue;
  const query = (dimensions: string[], order_by = byValue): Query => ({ measures: values, dimensions, filters, order_by, limit: ROW_LIMIT });
  const depths = type === 'matrix' ? rows.map((_, i) => i + 1) : [rows.length];
  const col = columns ? [columns] : [];
  const pivoted = !!columns && type !== 'table'; // a table lists the column field as a plain column
  return {
    levels: depths.map((n) => query([...rows.slice(0, n), ...col], n === rows.length ? axisOrder : byValue)),
    rowTotals: pivoted ? depths.map((n) => query(rows.slice(0, n), n === rows.length ? axisOrder : byValue)) : [],
    columnTotals: pivoted ? query(col) : null,
    grand: type === 'table' || type === 'matrix' ? { measures: values, dimensions: [], filters } : null,
  };
}

/**
 * Rows and values owned by someone else (the Summary page's Select Fields / Select Measures):
 * the visual always shows them, and the panel's Rows/Values edit them there.
 * Only the visual type and the Columns field are saved for the visual.
 */
export interface Binding {
  rows: string[];
  values: string[];
  rowOptions: string[];
  valueOptions: string[];
  set: (rows: string[], values: string[]) => void;
}

interface VisualOptions {
  id: string | null;
  defaults: VisualConfig | null; // what it shows until personalized (bound: only type and columns are used)
  filters: ApiFilters;
  loadDefault: boolean;          // false: the caller draws the default itself; only overrides load here
  bound?: Binding;
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function usePersonalizedVisual({ id, defaults, filters, loadDefault, bound }: VisualOptions) {
  const { state, setVisual } = useFilters();
  const meta = useMeta();
  const saved = id ? state.visuals[id] : undefined;
  const dims = new Map((meta.data?.dimensions ?? []).map((d) => [d.name, d]));
  const metaSettled = !!(meta.data || meta.error);

  let override: VisualConfig | null;
  let config: VisualConfig | null;
  let draft: VisualConfig; // what the panel edits
  if (bound) {
    const type = saved?.type ?? defaults?.type ?? 'matrix';
    const column = saved ? saved.columns : defaults?.columns ?? null;
    const columns = column && (!meta.data || dims.has(column)) ? column : null;
    draft = normalize({ type, columns, rows: bound.rows, values: bound.values });
    config = draft.rows.length && draft.values.length ? draft : null;
    override = saved ? config : null;
  } else {
    // Saved names are checked against /api/meta, so wait for it before showing a saved config.
    override = saved ? (meta.data ? againstMeta(saved, meta.data) : meta.error ? saved : null) : null;
    config = saved && !metaSettled ? null : override ?? defaults;
    draft = saved ?? config ?? { type: 'matrix', rows: [], columns: null, values: [] };
  }
  const ready = config && (override || loadDefault) && metaSettled;
  const data = useVisualData(ready ? config : null, filters, dims);
  const label = makeLabeler(meta.data);

  const set = (next: VisualConfig) => {
    if (!id) return;
    if (!bound) { setVisual(id, next); return; }
    if (!sameList(next.rows, bound.rows) || !sameList(next.values, bound.values)) bound.set(next.rows, next.values);
    if (saved || next.type !== (defaults?.type ?? 'matrix') || next.columns !== (defaults?.columns ?? null)) {
      setVisual(id, { type: next.type, columns: next.columns, rows: [], values: [] });
    }
  };
  return {
    meta,
    bound: !!bound,
    personalized: !!saved, // something is saved for this visual (Reset to default removes it)
    draft,
    override,   // the personalized config in use (null = the default)
    config,
    data: config && !metaSettled ? { loading: true } as Loadable<VisualData> : data,
    label,
    title: config ? visualTitle(config, label) : '',
    rowOptions: bound?.rowOptions ?? (meta.data?.dimensions ?? []).map((d) => d.name),
    valueOptions: bound?.valueOptions ?? (meta.data?.measures ?? []).map((m) => m.name),
    set,
    reset: () => { if (id) setVisual(id, null); },
  };
}
export type PersonalizedVisual = ReturnType<typeof usePersonalizedVisual>;

// ---- display helpers ------------------------------------------------------------------------ //
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Values as shown on axes, row headers and legends (period starts read as "Mar 2025", "Q1 2025", "2025"). */
export function displayValue(value: Value, name: string, field?: FieldMeta) {
  const iso = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value);
  if (iso && name.endsWith('_by_month')) return `${MONTHS[Number(value.slice(5, 7)) - 1]} ${value.slice(0, 4)}`;
  if (iso && name.endsWith('_by_quarter')) return `Q${Math.floor((Number(value.slice(5, 7)) - 1) / 3) + 1} ${value.slice(0, 4)}`;
  if (iso && name.endsWith('_by_year')) return value.slice(0, 4);
  return formatValue(value, field);
}

const rowKey = (row: Row, names: string[]) => JSON.stringify(names.map((n) => row[n] ?? null));

export const MAX_CATEGORIES = 60; // chart axis categories shown

/**
 * Which values share one chart. One axis per chart: counts and percentages get separate charts so
 * neither flattens the other. With a legend (Columns), or for pie/donut, each value gets its own chart.
 */
export function chartPanels(data: VisualData): string[][] {
  const { type, columns, values } = data.config;
  if (!isChart(type)) return [];
  if (columns || isPie(type)) return values.map((v) => [v]);
  const groups = new Map<string, string[]>();
  for (const v of values) {
    const format = data.fields[v]?.format === 'percentage' ? 'percentage' : 'number';
    groups.set(format, [...(groups.get(format) ?? []), v]);
  }
  return [...groups.values()].flatMap((g) => Array.from({ length: Math.ceil(g.length / MAX_SERIES) }, (_, i) => g.slice(i * MAX_SERIES, (i + 1) * MAX_SERIES)));
}

export interface ChartSeries { key: string; name: string; field?: FieldMeta }
export interface ChartModel { rows: Record<string, Value>[]; series: ChartSeries[] }

/** The categories of a chart: the most detailed rows, or the row totals when the column field is pivoted out. */
const categorySource = (data: VisualData) => (data.config.columns && data.config.type !== 'table' ? data.rowTotals[data.rowTotals.length - 1] : data.leaf);

/** Category rows with one key per series: the given values, or (with a legend) the column values of the one value. */
export function chartModel(data: VisualData, values: string[]): ChartModel {
  const { config, fields } = data;
  const { rows: dims, columns } = config;
  const label = (r: Row) => dims.map((d) => displayValue(r[d] ?? null, d, fields[d])).join(' › ');
  const first = values[0];

  if (isPie(config.type)) {
    const top = [...categorySource(data)].sort((a, b) => Number(b[first] ?? 0) - Number(a[first] ?? 0)).slice(0, MAX_SERIES);
    return { rows: top.map((r) => ({ label: label(r), s0: r[first] ?? null })), series: [{ key: 's0', name: first, field: fields[first] }] };
  }
  if (!columns) {
    return {
      rows: data.leaf.slice(0, MAX_CATEGORIES).map((r) => ({ label: label(r), ...Object.fromEntries(values.map((v, i) => [`s${i}`, r[v] ?? null])) })),
      series: values.map((v, i) => ({ key: `s${i}`, name: v, field: fields[v] })),
    };
  }
  const index = new Map(data.columnValues.map((v, i) => [JSON.stringify(v), i]));
  const categories = new Map<string, Record<string, Value>>();
  for (const r of categorySource(data).slice(0, MAX_CATEGORIES)) categories.set(rowKey(r, dims), { label: label(r) }); // category order
  for (const r of data.leaf) {
    const i = index.get(JSON.stringify(r[columns] ?? null));
    const row = categories.get(rowKey(r, dims));
    if (i !== undefined && row) row[`s${i}`] = r[first] ?? null;
  }
  return {
    rows: [...categories.values()],
    series: data.columnValues.map((v, i) => ({ key: `s${i}`, name: displayValue(v, columns, fields[columns]), field: fields[first] })),
  };
}

/** Notes shown under the visual about what was left out. */
export function visualNotes(data: VisualData, label: (name: string) => string): string[] {
  const { config, columnCount, columnValues } = data;
  const notes: string[] = [];
  const pie = isPie(config.type);
  const categories = isChart(config.type) ? categorySource(data).length : 0;
  if (config.columns && pie) notes.push(`Pie and donut charts don't use Columns (${label(config.columns)}).`);
  if (config.columns && !pie && columnCount > columnValues.length) {
    notes.push(`Showing the top ${columnValues.length} of ${columnCount.toLocaleString()} ${label(config.columns)} values by ${label(config.values[0])}.`);
  }
  if (pie && categories > MAX_SERIES) notes.push(`Showing the ${MAX_SERIES} largest of ${categories.toLocaleString()} slices.`);
  if (!pie && categories > MAX_CATEGORIES) {
    notes.push(`Showing the first ${MAX_CATEGORIES} of ${categories.toLocaleString()} ${config.rows.map(label).join(' › ')} values on the chart (Export CSV has all).`);
  }
  if (data.truncated) notes.push(`Some groupings have more than ${ROW_LIMIT.toLocaleString()} rows; only the largest are shown. Add filters to narrow it down.`);
  return notes;
}

/**
 * CSV of what the visual shows: the flat table, or (matrix and charts) one line per most detailed
 * row with every value; with a column field, one block of values per shown column plus Total.
 */
export function visualCsv(data: VisualData, label: (name: string) => string): { header: string[]; rows: string[][] } {
  const { config, fields } = data;
  const fmt = (v: Value | undefined, name: string) => (fields[name]?.type === 'measure' ? formatValue(v ?? null, fields[name]) : displayValue(v ?? null, name, fields[name]));
  const { rows: dims, columns, values } = config;
  if (config.type === 'table' || !columns) {
    const names = [...dims, ...(columns ? [columns] : []), ...values];
    return { header: names.map(label), rows: data.leaf.map((r) => names.map((n) => fmt(r[n], n))) };
  }
  const cells = new Map(data.leaf.map((r) => [rowKey(r, [...dims, columns]), r]));
  const groups = data.columnValues.map((v) => ({ value: v, name: displayValue(v, columns, fields[columns]) }));
  const header = [...dims.map(label), ...groups.flatMap((g) => values.map((m) => `${g.name} – ${label(m)}`)), ...values.map((m) => `Total – ${label(m)}`)];
  const rows = categorySource(data).map((total) => [
    ...dims.map((d) => fmt(total[d], d)),
    ...groups.flatMap((g) => values.map((m) => fmt(cells.get(rowKey({ ...total, [columns]: g.value }, [...dims, columns]))?.[m], m))),
    ...values.map((m) => fmt(total[m], m)),
  ]);
  return { header, rows };
}
