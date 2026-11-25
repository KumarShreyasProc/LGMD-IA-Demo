import { useState } from 'react';
import { About } from './pages/About';
import { Summary } from './pages/Summary';
import { DetailedTable } from './pages/DetailedTable';
import { Charts } from './pages/Charts';
import { USE_SAMPLE_DATA } from './data/api';

const PAGES = { About, Summary, 'Detailed Table View': DetailedTable, Charts } as const;
type PageName = keyof typeof PAGES;

export default function App() {
  const [page, setPage] = useState<PageName>('Summary');
  const Current = PAGES[page];
  return (
    <div className="shell">
      <header className="top">
        <span className="brand">bridgebio</span>
        <h1>Insights Accelerator</h1>
        {USE_SAMPLE_DATA ? <span className="badge">Sample data</span> : <span />}
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
          <p className="refresh">Refresh Date: <span>{new Date().toLocaleDateString()}</span></p>
        </aside>
        <main className="main"><Current /></main>
      </div>
    </div>
  );
}
