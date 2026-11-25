import type { DateRange as Range } from '../data/api';

export function DateRange({ label, value, onChange }: { label: string; value: Range; onChange: (r: Range) => void }) {
  return (
    <fieldset className="date-range">
      <legend>{label}</legend>
      <label>From <input type="date" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} /></label>
      <label>To <input type="date" value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} /></label>
    </fieldset>
  );
}
