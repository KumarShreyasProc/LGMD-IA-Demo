import { MEASURES, SOURCES } from '../config/model';
import { api, useApi } from '../data/api';

const connected = (source: string) => MEASURES.some((m) => m.source === source && m.live);

export function About() {
  const meta = useApi('meta', api.meta);
  const backend = new Map((meta.data?.measures ?? []).map((m) => [m.name, m]));
  return (
    <div className="page about">
      <div className="about-cards">
        <div className="about-card"><h3>Purpose</h3><p>Self-serve analytics for ad hoc deep dives into Welgemda patients, demand and access.</p></div>
        <div className="about-card"><h3>Data sources</h3><p>{SOURCES.map((s) => `${s.label} (${s.detail}${connected(s.id) ? '' : ', not connected yet'})`).join(' · ')}</p></div>
        <div className="about-card"><h3>How to start</h3><p>Go to <strong>Summary</strong>, pick a source, then tick fields and measures to build a table.</p></div>
      </div>
      <section className="about-table">
        <h3>Measures</h3>
        {meta.error && <p className="error">Couldn't load measure definitions: {meta.error}</p>}
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Measure</th><th>Definition</th><th>Source</th><th>Status</th></tr></thead>
            <tbody>
              {MEASURES.map((m) => {
                const b = backend.get(m.id);
                return (
                  <tr key={m.id} className={m.live ? '' : 'flag'}>
                    <td><strong>{m.label}</strong></td>
                    <td>
                      {m.live ? (b ? <>{b.description} <span className="muted">(metric view: {b.label})</span></> : meta.loading ? 'Loading…' : '') : m.definition}
                    </td>
                    <td>{SOURCES.find((s) => s.id === m.source)?.label}</td>
                    <td>{m.live ? 'Live' : 'Not available yet'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted">Highlighted rows are planned measures the backend does not serve yet.</p>
      </section>
    </div>
  );
}
