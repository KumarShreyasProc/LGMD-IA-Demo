// "Personalize this visual": what a visual shows, independent of how it loads or renders.
import { FIELDS, MEASURES } from '../config/model';
import type { Meta } from '../data/api';

export const VISUAL_TYPES = [
  { id: 'table', label: 'Table' },
  { id: 'matrix', label: 'Matrix' },
  { id: 'clustered-column', label: 'Clustered column' },
  { id: 'clustered-bar', label: 'Clustered bar' },
  { id: 'stacked-column', label: 'Stacked column' },
  { id: 'stacked-bar', label: 'Stacked bar' },
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
  { id: 'pie', label: 'Pie' },
  { id: 'donut', label: 'Donut' },
] as const;
export type VisualType = (typeof VISUAL_TYPES)[number]['id'];

export interface VisualConfig {
  type: VisualType;
  rows: string[];          // dimensions: matrix rows (outer → inner) or the chart axis
  columns: string | null;  // dimension: matrix columns or the chart legend
  values: string[];        // measures
}

export const isChart = (type: VisualType) => type !== 'table' && type !== 'matrix';
export const isPie = (type: VisualType) => type === 'pie' || type === 'donut';

const TYPE_IDS: readonly string[] = VISUAL_TYPES.map((t) => t.id);
const isNameList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** One dimension per role: no duplicates, and the column can't also be a row. */
export function normalize(config: VisualConfig): VisualConfig {
  const rows = [...new Set(config.rows)];
  return {
    type: config.type,
    rows,
    columns: config.columns && !rows.includes(config.columns) ? config.columns : null,
    values: [...new Set(config.values)],
  };
}

/** Saved data → config, or null if it isn't one (names are checked against /api/meta later). */
export function parseVisual(raw: unknown): VisualConfig | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { type, rows, columns, values } = raw as Record<string, unknown>;
  if (typeof type !== 'string' || !TYPE_IDS.includes(type) || !isNameList(rows) || !isNameList(values)) return null;
  if (columns !== null && typeof columns !== 'string') return null;
  return normalize({ type: type as VisualType, rows, columns, values });
}

/** Drops names the backend no longer has; null if nothing usable is left. */
export function againstMeta(config: VisualConfig, meta: Meta): VisualConfig | null {
  const dims = new Set(meta.dimensions.map((d) => d.name));
  const measures = new Set(meta.measures.map((m) => m.name));
  const rows = config.rows.filter((d) => dims.has(d));
  const values = config.values.filter((m) => measures.has(m));
  if (!rows.length || !values.length) return null;
  return normalize({ ...config, rows, values, columns: config.columns && dims.has(config.columns) ? config.columns : null });
}

/** Display name: the dashboard's own label first, then the backend's, then the raw name. */
export function makeLabeler(meta?: Meta) {
  const backend = new Map([...(meta?.dimensions ?? []), ...(meta?.measures ?? [])].map((x) => [x.name, x.label]));
  return (name: string) =>
    MEASURES.find((m) => m.id === name)?.label ?? FIELDS.find((f) => f.id === name)?.label ?? backend.get(name) ?? name;
}

/** "New patients written by Enrollment Month and Current Status" */
export function visualTitle(config: VisualConfig, label: (name: string) => string) {
  const by = config.rows.map(label).join(', ');
  return `${config.values.map(label).join(', ')} by ${by}${config.columns ? ` and ${label(config.columns)}` : ''}`;
}
