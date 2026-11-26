import { useFilters, type ActiveFilter } from '../state/filters';

/** "Filters Applied On" chips for the current page, plus saved filters this page doesn't use. */
export function AppliedFilters({ applied, notApplied }: { applied: ActiveFilter[]; notApplied: ActiveFilter[] }) {
  const { clearFilter } = useFilters();
  if (!applied.length && !notApplied.length) return null;
  return (
    <div className="applied">
      {applied.length > 0 && (
        <div className="chips" aria-label="Filters applied on this page">
          <span className="chips-label">Filters Applied On:</span>
          {applied.map((f) => (
            <button key={f.id} type="button" className="chip" onClick={() => clearFilter(f.id)} aria-label={`Remove filter ${f.label}`}>
              {f.label}: {f.text} ✕
            </button>
          ))}
        </div>
      )}
      {notApplied.length > 0 && (
        <p className="muted not-applied" title={notApplied.map((f) => `${f.label}: ${f.text}`).join('\n')}>
          Saved, not used on this page: {notApplied.map((f) => f.label).join(', ')}
        </p>
      )}
    </div>
  );
}
