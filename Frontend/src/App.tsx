import { useState } from 'react';
import { About } from './pages/About';
import { Summary } from './pages/Summary';
import { DetailedTable } from './pages/DetailedTable';
import { Charts } from './pages/Charts';
import { api, byName, formatValue, useApi } from './data/api';

const PAGES = { About, Summary, 'Detailed Table View': DetailedTable, Charts } as const;
type PageName = keyof typeof PAGES;

/** When attruby_ia was last loaded (MAX(refresh_date)). */
function RefreshDate() {
  const refresh = useApi('refresh-date', () => api.kpis(['data_refresh_date']));
  const text = refresh.loading ? '…'
    : refresh.error ? 'unavailable'
    : formatValue(refresh.data?.values.data_refresh_date, byName(refresh.data?.fields).data_refresh_date) || '–';
  return <p className="refresh" title={refresh.error}>Refresh Date: <span>{text}</span></p>;
}

export default function App() {
  const [page, setPage] = useState<PageName>('Summary');
  const Current = PAGES[page];
  return (
    <div className="shell">
      <header className="top">
        <span className="brand">bridgebio</span>
        <h1>Insights Accelerator</h1>
        <span />
      </header>
      <div className="body">
        <aside className="side">
          <nav aria-label="Pages">
            {(Object.keys(PAGES) as PageName[]).map((p) => (
              <button key={p} type="button" className={`nav-btn ${page === p ? 'on' : ''}`} aria-current={page === p ? 'page' : undefined} onClick={() => setPage(p)}>
                {p}
              </button>
            ))}
          </nav>
          <RefreshDate />
        </aside>
        <main className="main"><Current /></main>
      </div>
    </div>
  );
}
