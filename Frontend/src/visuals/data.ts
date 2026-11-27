// Loads and shapes the data for a (possibly personalized) visual.
// Every number, including subtotals and totals, comes from its own /api/query grouping:
// ratios are never summed or averaged in the browser.
import {
  api, byName, formatValue, useApi, useMeta,
  type ApiFilters, type DimensionMeta, type FieldMeta, type Loadable, type QueryResult, type Row, type Value,
} from '../data/api';
import { useFilters } from '../state/filters';
import { againstMeta, isChart, isPie, makeLabeler, visualTitle, type VisualConfig } from './config';

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
 * A visual that can be personalized. `defaults` is what it shows until someone personalizes it;
 * with `loadDefault` false the caller draws the default itself and only overrides load here.
 */
export function usePersonalizedVisual(id: string | null, defaults: VisualConfig | null, filters: ApiFilters, loadDefault: boolean) {
  const { state, setVisual } = useFilters();
  const meta = useMeta();
  const saved = id ? state.visuals[id] : undefined;
  const waiting = !!saved && !meta.data && !meta.error;        // can't validate the saved names yet
  const override = saved ? (meta.data ? againstMeta(saved, meta.data) : meta.error ? saved : null) : null;
  const config = waiting ? null : override ?? defaults;
  const dims = new Map((meta.data?.dimensions ?? []).map((d) => [d.name, d]));
  const ready = config && (override || loadDefault) && (meta.data || meta.error);
  const data = useVisualData(ready ? config : null, filters, dims);
  const label = makeLabeler(meta.data);
  return {
    meta,
    saved,      // what the panel edits (may be incomplete while someone is building it)
    override,   // saved config checked against /api/meta (null = show the default)
    config,
    defaults,
    data: waiting || (config && !(meta.data || meta.error)) ? { loading: true } as Loadable<VisualData> : data,
    label,
    title: config ? visualTitle(config, label) : '',
    set: (next: VisualConfig) => { if (id) setVisual(id, next); },
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

export interface ChartSeries { key: string; name: string; field?: FieldMeta }
export interface ChartModel { rows: Record<string, Value>[]; series: ChartSeries[] }

/** Category rows with one key per series: the values, or (with a legend) the column values of the first value. */
export function chartModel(data: VisualData): ChartModel {
  const { config, fields } = data;
  const { rows: dims, columns, values } = config;
  const label = (r: Row) => dims.map((d) => displayValue(r[d] ?? null, d, fields[d])).join(' › ');
  const first = values[0];

  if (isPie(config.type)) {
    const source = columns ? data.rowTotals[data.rowTotals.length - 1] : data.leaf;
    const top = [...source].sort((a, b) => Number(b[first] ?? 0) - Number(a[first] ?? 0)).slice(0, MAX_SERIES);
    return { rows: top.map((r) => ({ label: label(r), s0: r[first] ?? null })), series: [{ key: 's0', name: first, field: fields[first] }] };
  }
  if (!columns) {
    const shown = values.slice(0, MAX_SERIES);
    return {
      rows: data.leaf.map((r) => ({ label: label(r), ...Object.fromEntries(shown.map((v, i) => [`s${i}`, r[v] ?? null])) })),
      series: shown.map((v, i) => ({ key: `s${i}`, name: v, field: fields[v] })),
    };
  }
  const index = new Map(data.columnValues.map((v, i) => [JSON.stringify(v), i]));
  const categories = new Map<string, Record<string, Value>>();
  for (const r of data.rowTotals[data.rowTotals.length - 1]) categories.set(rowKey(r, dims), { label: label(r) }); // category order
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
  if (config.columns && pie) notes.push(`Pie and donut charts don't use Columns (${label(config.columns)}).`);
  if (config.columns && !pie && columnCount > columnValues.length) {
    notes.push(`Showing the top ${columnValues.length} of ${columnCount.toLocaleString()} ${label(config.columns)} values by ${label(config.values[0])}.`);
  }
  if (isChart(config.type) && config.values.length > 1 && (pie || config.columns)) {
    notes.push(`${pie ? 'Pie and donut charts' : `With ${label(config.columns!)} as the legend, the chart`} show${pie ? '' : 's'} ${label(config.values[0])} only.`);
  }
  if (isChart(config.type) && !pie && !config.columns && config.values.length > MAX_SERIES) {
    notes.push(`Charts show the first ${MAX_SERIES} values.`);
  }
  if (pie) {
    const source = config.columns ? data.rowTotals[data.rowTotals.length - 1] : data.leaf;
    if (source.length > MAX_SERIES) notes.push(`Showing the ${MAX_SERIES} largest of ${source.length.toLocaleString()} slices.`);
  }
  if (data.truncated) notes.push(`Some groupings have more than ${ROW_LIMIT.toLocaleString()} rows; only the largest are shown. Add filters to narrow it down.`);
  return notes;
}

/** CSV of what the visual shows: the flat table, the matrix's most detailed level, or the chart's data. */
export function visualCsv(data: VisualData, label: (name: string) => string): { header: string[]; rows: string[][] } {
  const { config, fields } = data;
  const fmt = (v: Value | undefined, name: string) => (fields[name]?.type === 'measure' ? formatValue(v ?? null, fields[name]) : displayValue(v ?? null, name, fields[name]));
  if (config.type === 'table') {
    const names = [...config.rows, ...(config.columns ? [config.columns] : []), ...config.values];
    return { header: names.map(label), rows: data.leaf.map((r) => names.map((n) => fmt(r[n], n))) };
  }
  if (isChart(config.type)) {
    const model = chartModel(data);
    const seriesName = (s: ChartSeries) => (config.columns && !isPie(config.type) ? s.name : label(s.name));
    return {
      header: [config.rows.map(label).join(' › '), ...model.series.map(seriesName)],
      rows: model.rows.map((r) => [String(r.label), ...model.series.map((s) => formatValue(r[s.key] ?? null, s.field))]),
    };
  }
  // Matrix: one line per most detailed row; with a column, one block of values per shown column plus Total.
  const { rows: dims, columns, values } = config;
  if (!columns) {
    return { header: [...dims, ...values].map(label), rows: data.leaf.map((r) => [...dims, ...values].map((n) => fmt(r[n], n))) };
  }
  const cells = new Map(data.leaf.map((r) => [rowKey(r, [...dims, columns]), r]));
  const groups = data.columnValues.map((v) => ({ value: v, name: displayValue(v, columns, fields[columns]) }));
  const header = [...dims.map(label), ...groups.flatMap((g) => values.map((m) => `${g.name} – ${label(m)}`)), ...values.map((m) => `Total – ${label(m)}`)];
  const rows = data.rowTotals[data.rowTotals.length - 1].map((total) => [
    ...dims.map((d) => fmt(total[d], d)),
    ...groups.flatMap((g) => values.map((m) => fmt(cells.get(rowKey({ ...total, [columns]: g.value }, [...dims, columns]))?.[m], m))),
    ...values.map((m) => fmt(total[m], m)),
  ]);
  return { header, rows };
}
