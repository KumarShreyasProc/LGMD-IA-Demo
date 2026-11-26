// App-wide filter state: one store for every page (like synced slicers in Power BI),
// saved in localStorage so it survives page switches, refreshes and reopening the app.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  DATE_FILTERS, FIELDS, MEASURES, PAGE_FILTERS, PATIENT_ID_FILTER, SOURCES, filterLabel,
  type PageId, type SourceId,
} from '../config/model';
import {
  api, formatValue, toApiFilters,
  type ApiFilters, type DateRange, type DateRanges, type Selections, type Value,
} from '../data/api';

export interface FilterState {
  sources: SourceId[];     // Summary "Select Source"
  fields: string[];        // Summary fields, in the order they were checked (= matrix hierarchy)
  measures: string[];      // Summary measures
  selections: Selections;  // slicer values by dimension
  dates: DateRanges;       // date ranges by date column
  patientId: string;       // Detailed Table View patient ID search
}

export const DEFAULT_STATE: FilterState = {
  sources: ['sphub'],
  fields: ['enrolling_hcp_territory'],
  measures: ['new_patients_filled'],
  selections: {},
  dates: {},
  patientId: '',
};

const STORAGE_KEY = 'insights-accelerator.filters.v1';
const OPTION_LIMIT = 500; // /api/filter-options default; a full list can't prove a value is gone
const DATE_IDS = new Set(DATE_FILTERS.map((d) => d.id));
const SELECTION_IDS = new Set(
  Object.values(PAGE_FILTERS).flat().filter((id) => !DATE_IDS.has(id) && id !== PATIENT_ID_FILTER),
);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---- reading saved state (anything unexpected falls back to the default) ---------------- //
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isValue = (v: unknown): v is Value => v === null || ['string', 'number', 'boolean'].includes(typeof v);

/** Known ids only, no duplicates; the default if the list is malformed or nothing in it still exists. */
function idList<T extends string>(raw: unknown, known: readonly string[], fallback: T[]): T[] {
  if (!Array.isArray(raw)) return fallback;
  const kept = [...new Set(raw.filter((x): x is T => typeof x === 'string' && known.includes(x)))];
  return raw.length > 0 && kept.length === 0 ? fallback : kept;
}

function sanitize(raw: unknown): FilterState {
  if (!isRecord(raw)) return DEFAULT_STATE;
  const selections: Selections = {};
  if (isRecord(raw.selections)) {
    for (const [id, values] of Object.entries(raw.selections)) {
      if (SELECTION_IDS.has(id) && Array.isArray(values) && values.length && values.every(isValue)) {
        selections[id] = [...new Set(values)];
      }
    }
  }
  const dates: DateRanges = {};
  if (isRecord(raw.dates)) {
    for (const [id, range] of Object.entries(raw.dates)) {
      if (!DATE_IDS.has(id) || !isRecord(range)) continue;
      const { from, to } = range;
      const ok = (d: unknown): d is string => d === '' || (typeof d === 'string' && ISO_DATE.test(d));
      if (ok(from) && ok(to) && (from || to)) dates[id] = { from, to };
    }
  }
  return {
    sources: idList(raw.sources, SOURCES.map((s) => s.id), DEFAULT_STATE.sources),
    fields: idList(raw.fields, FIELDS.filter((f) => f.live).map((f) => f.id), DEFAULT_STATE.fields),
    measures: idList(raw.measures, MEASURES.filter((m) => m.live).map((m) => m.id), DEFAULT_STATE.measures),
    selections,
    dates,
    patientId: typeof raw.patientId === 'string' ? raw.patientId.slice(0, 200) : '',
  };
}

function load(): FilterState {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved ? sanitize(JSON.parse(saved)) : DEFAULT_STATE;
  } catch {
    return DEFAULT_STATE; // storage blocked, or corrupt JSON
  }
}

function save(state: FilterState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage blocked or full: filters still work for this visit
  }
}

/** Drops saved slicer values that no longer occur in the data (checked once against unfiltered options). */
function pruneSelections(selections: Selections, options: Record<string, Value[]>): Selections {
  let changed = false;
  const out: Selections = {};
  for (const [id, values] of Object.entries(selections)) {
    const known = options[id];
    const kept = known && known.length < OPTION_LIMIT ? values.filter((v) => known.includes(v)) : values;
    if (kept.length !== values.length) changed = true;
    if (kept.length) out[id] = kept;
  }
  return changed ? out : selections;
}

// ---- store ----------------------------------------------------------------------------- //
interface Store {
  state: FilterState;
  update: (patch: Partial<FilterState>) => void;
  setSelection: (id: string, values: Value[]) => void;
  setDate: (id: string, range: DateRange) => void;
  clearFilter: (id: string) => void;
  clearAll: () => void;
  isDefault: boolean;
}

const FilterContext = createContext<Store | null>(null);

export function FilterProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(load);

  useEffect(() => save(state), [state]);

  useEffect(() => {
    const dims = Object.keys(state.selections);
    if (!dims.length) return;
    let current = true;
    api.filterOptions(dims, {}).then(
      (options) => { if (current) setState((s) => ({ ...s, selections: pruneSelections(s.selections, options) })); },
      () => {}, // couldn't check: keep the saved values
    );
    return () => { current = false; };
  }, []); // once, for the values loaded from storage

  const store = useMemo<Store>(() => {
    const setSelection = (id: string, values: Value[]) => setState((s) => {
      const { [id]: _, ...rest } = s.selections;
      return { ...s, selections: values.length ? { ...rest, [id]: values } : rest };
    });
    const setDate = (id: string, range: DateRange) => setState((s) => {
      const { [id]: _, ...rest } = s.dates;
      return { ...s, dates: range.from || range.to ? { ...rest, [id]: range } : rest };
    });
    return {
      state,
      update: (patch) => setState((s) => ({ ...s, ...patch })),
      setSelection,
      setDate,
      clearFilter: (id) => {
        if (id === PATIENT_ID_FILTER) setState((s) => ({ ...s, patientId: '' }));
        else if (DATE_IDS.has(id)) setDate(id, { from: '', to: '' });
        else setSelection(id, []);
      },
      clearAll: () => setState(DEFAULT_STATE),
      isDefault: JSON.stringify(state) === JSON.stringify(DEFAULT_STATE),
    };
  }, [state]);

  return <FilterContext.Provider value={store}>{children}</FilterContext.Provider>;
}

export function useFilters(): Store {
  const store = useContext(FilterContext);
  if (!store) throw new Error('useFilters must be used inside <FilterProvider>');
  return store;
}

// ---- what a page applies ----------------------------------------------------------------- //
export interface ActiveFilter { id: string; label: string; text: string }

function activeFilters(state: FilterState): ActiveFilter[] {
  const label = filterLabel;
  return [
    ...Object.entries(state.selections).map(([id, v]) => ({ id, label: label(id), text: v.map((x) => formatValue(x)).join(', ') })),
    ...Object.entries(state.dates).map(([id, r]) => ({ id, label: label(id), text: `${r.from || '…'} to ${r.to || '…'}` })),
    ...(state.patientId.trim() ? [{ id: PATIENT_ID_FILTER, label: label(PATIENT_ID_FILTER), text: `contains “${state.patientId.trim()}”` }] : []),
  ];
}

/**
 * Splits the shared filters into the ones this page has slicers for (sent to the backend)
 * and the ones that stay saved but don't apply here.
 */
export function pageFilters(state: FilterState, page: PageId) {
  const ids = new Set(PAGE_FILTERS[page]);
  const pick = <T,>(obj: Record<string, T>) => Object.fromEntries(Object.entries(obj).filter(([id]) => ids.has(id)));
  const patientId = ids.has(PATIENT_ID_FILTER) ? state.patientId.trim() : '';
  const filters: ApiFilters = {
    ...toApiFilters(pick(state.selections), pick(state.dates)),
    ...(patientId ? { [PATIENT_ID_FILTER]: { contains: patientId } } : {}),
  };
  const all = activeFilters(state);
  return { filters, applied: all.filter((f) => ids.has(f.id)), notApplied: all.filter((f) => !ids.has(f.id)) };
}
