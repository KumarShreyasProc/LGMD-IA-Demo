import { useEffect, useId, useRef } from 'react';
import { VISUAL_TYPES, isPie, normalize, type VisualConfig } from './config';
import type { PersonalizedVisual } from './data';

/** The Power BI "Personalize this visual" icon (a chart with a pencil). */
export function PersonalizeButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button type="button" className="personalize-btn" aria-label="Personalize this visual" title="Personalize this visual"
      aria-expanded={open} onClick={onClick}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4">
        <path d="M2 14V8M5.5 14V5M9 14V9" strokeLinecap="round" />
        <path d="M10.5 6.5 14 3l-1.5-1.5L9 5l-.5 2z" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

/** Side panel like Power BI's: visual type, Rows, Columns, Values, Reset. Changes apply and save right away. */
export function PersonalizePanel({ visual, onClose }: { visual: PersonalizedVisual; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const headingId = useId();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => { // focus the panel once when it opens; Escape closes it
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const current = visual.draft;
  const change = (patch: Partial<VisualConfig>) => visual.set(normalize({ ...current, ...patch }));
  const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);
  const options = (names: string[]) => names.map((name) => ({ name, label: visual.label(name) })).sort(byLabel);
  const rowOptions = options(visual.rowOptions);
  const dims = options((visual.meta.data?.dimensions ?? []).map((d) => d.name)); // Columns can be any dimension
  const measures = options(visual.valueOptions);

  return (
    <aside className="personalize" role="dialog" aria-modal="false" aria-labelledby={headingId} tabIndex={-1} ref={ref}>
      <header>
        <h2 id={headingId}>Personalize this visual</h2>
        <button type="button" className="close" aria-label="Close" onClick={onClose}>✕</button>
      </header>
      <p className="muted">Changes apply right away and are saved in this browser.</p>
      {visual.bound && (
        <p className="muted">Rows and Values are the page's Select Fields and Select Measures lists: changing them here changes them there, for the table and the chart.</p>
      )}
      {visual.meta.error && <p className="error">Couldn't load the field list: {visual.meta.error}</p>}

      <fieldset>
        <legend>Visualization type</legend>
        <div className="type-grid">
          {VISUAL_TYPES.map((t) => (
            <button key={t.id} type="button" aria-pressed={current.type === t.id} className={current.type === t.id ? 'on' : ''}
              onClick={() => change({ type: t.id })}>{t.label}</button>
          ))}
        </div>
      </fieldset>

      <FieldWell title={isPie(current.type) ? 'Rows (slices)' : 'Rows (axis)'} items={current.rows} options={rowOptions.filter((d) => d.name !== current.columns)}
        label={visual.label} onChange={(rows) => change({ rows })} />

      <label className="well">
        <span className="well-title">Columns (legend / matrix columns)</span>
        <select value={current.columns ?? ''} onChange={(e) => change({ columns: e.target.value || null })}>
          <option value="">None</option>
          {dims.filter((d) => !current.rows.includes(d.name)).map((d) => <option key={d.name} value={d.name}>{d.label}</option>)}
        </select>
      </label>

      <FieldWell title="Values" items={current.values} options={measures} label={visual.label} onChange={(values) => change({ values })} />

      {isPie(current.type) && <p className="muted">Pie and donut charts use the first value and ignore Columns.</p>}
      <button type="button" className="reset" disabled={!visual.personalized} onClick={visual.reset}>Reset to default</button>
      {visual.bound && <p className="muted">Reset to default restores the visual type and Columns; the field and measure lists stay as they are.</p>}
    </aside>
  );
}

/** An ordered list of fields: add from a dropdown, move up, remove (the last one stays: a visual needs one). */
function FieldWell({ title, items, options, label, onChange }: {
  title: string; items: string[]; options: { name: string; label: string }[];
  label: (name: string) => string; onChange: (items: string[]) => void;
}) {
  const id = useId();
  const move = (i: number) => onChange([...items.slice(0, i - 1), items[i], items[i - 1], ...items.slice(i + 1)]);
  return (
    <div className="well" role="group" aria-labelledby={id}>
      <span className="well-title" id={id}>{title}</span>
      <ul className="well-items">
        {items.map((name, i) => (
          <li key={name}>
            <span>{label(name)}</span>
            <button type="button" disabled={i === 0} aria-label={`Move ${label(name)} up`} onClick={() => move(i)}>↑</button>
            <button type="button" disabled={items.length === 1} aria-label={`Remove ${label(name)}`}
              title={items.length === 1 ? 'A visual needs at least one field here' : undefined} onClick={() => onChange(items.filter((x) => x !== name))}>✕</button>
          </li>
        ))}
      </ul>
      <select value="" aria-label={`Add to ${title}`} onChange={(e) => e.target.value && onChange([...items, e.target.value])}>
        <option value="">Add a field…</option>
        {options.filter((o) => !items.includes(o.name)).map((o) => <option key={o.name} value={o.name}>{o.label}</option>)}
      </select>
    </div>
  );
}
