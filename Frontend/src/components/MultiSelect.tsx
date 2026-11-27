import { useEffect, useId, useRef, useState } from 'react';
import { formatValue, useApi, useDebounced, type Value } from '../data/api';

interface Props {
  label: string;
  options: Value[];
  value: Value[];
  onChange: (next: Value[]) => void;
  loading?: boolean;
  /** Server-side search, for slicers with more values than the dropdown loads (e.g. IDs). */
  search?: { key: string; load: (text: string) => Promise<Value[]> };
}

/** Power BI–style dropdown slicer: shows "All" when nothing is selected; null is shown as "(Blank)". */
export function MultiSelect({ label, options, value, onChange, loading = false, search }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const query = useDebounced(text.trim());
  const remote = useApi(open && search && query ? JSON.stringify(['slicer-search', search.key, query]) : null, () => search!.load(query));
  const needle = text.trim().toLowerCase();
  const matches = (v: Value) => !needle || formatValue(v).toLowerCase().includes(needle);
  // While searching on the server, show its matches (the loaded options are only the first 500).
  const pool = search && query && remote.data ? remote.data : options;

  const summary = value.length === 0 ? 'All' : value.length === 1 ? formatValue(value[0]) : `${value.length} selected`;
  const toggle = (opt: Value) => onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt]);
  // Keep selected values listed even when other filters have removed them from the options.
  const shown = [...value.filter((v) => !pool.includes(v)), ...pool].filter(matches);
  const searching = !!(search && needle && (text.trim() !== query || remote.loading));

  return (
    <div className="slicer" ref={ref}>
      <label htmlFor={id} className="slicer-label">{label}</label>
      <button id={id} type="button" className="slicer-box" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{summary}</span><span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div className="slicer-menu" role="listbox" aria-multiselectable="true">
          <input className="search" type="search" placeholder="Search" aria-label={`Search ${label}`} value={text} onChange={(e) => setText(e.target.value)} />
          <button type="button" className="slicer-clear" onClick={() => onChange([])}>Select all</button>
          {(loading || searching) && <p className="muted">{searching ? 'Searching…' : 'Loading values…'}</p>}
          {remote.error && <p className="error">Search failed: {remote.error}</p>}
          {!loading && !searching && shown.length === 0 && <p className="muted">No values</p>}
          {shown.map((opt) => (
            <label key={JSON.stringify(opt)} className="check">
              <input type="checkbox" checked={value.includes(opt)} onChange={() => toggle(opt)} />
              {formatValue(opt)}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
