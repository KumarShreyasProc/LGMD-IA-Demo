import { useEffect, useId, useRef, useState } from 'react';
import { formatValue, type Value } from '../data/api';

interface Props {
  label: string;
  options: Value[];
  value: Value[];
  onChange: (next: Value[]) => void;
  loading?: boolean;
}

/** Power BI–style dropdown slicer: shows "All" when nothing is selected; null is shown as "(Blank)". */
export function MultiSelect({ label, options, value, onChange, loading = false }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const summary = value.length === 0 ? 'All' : value.length === 1 ? formatValue(value[0]) : `${value.length} selected`;
  const toggle = (opt: Value) => onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt]);
  // Keep selected values listed even when other filters have removed them from the options.
  const shown = [...value.filter((v) => !options.includes(v)), ...options];

  return (
    <div className="slicer" ref={ref}>
      <label htmlFor={id} className="slicer-label">{label}</label>
      <button id={id} type="button" className="slicer-box" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{summary}</span><span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div className="slicer-menu" role="listbox" aria-multiselectable="true">
          <button type="button" className="slicer-clear" onClick={() => onChange([])}>Select all</button>
          {loading && <p className="muted">Loading values…</p>}
          {!loading && shown.length === 0 && <p className="muted">No values</p>}
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
