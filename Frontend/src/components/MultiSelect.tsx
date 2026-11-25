import { useEffect, useId, useRef, useState } from 'react';

interface Props {
  label: string;
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
}

/** Power BI–style dropdown slicer: shows "All" when nothing is selected. */
export function MultiSelect({ label, options, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const summary = value.length === 0 ? 'All' : value.length === 1 ? value[0] : `${value.length} selected`;
  const toggle = (opt: string) => onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt]);

  return (
    <div className="slicer" ref={ref}>
      <label htmlFor={id} className="slicer-label">{label}</label>
      <button id={id} type="button" className="slicer-box" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{summary}</span><span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div className="slicer-menu" role="listbox" aria-multiselectable="true">
          <button type="button" className="slicer-clear" onClick={() => onChange([])}>Select all</button>
          {options.map((opt) => (
            <label key={opt} className="check">
              <input type="checkbox" checked={value.includes(opt)} onChange={() => toggle(opt)} />
              {opt}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
