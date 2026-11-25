import { MEASURES, SOURCES } from '../config/model';

export function About() {
  return (
    <div className="page about">
      <div className="about-cards">
        <div className="about-card"><h3>Purpose</h3><p>Self-serve analytics for ad hoc deep dives into Welgemda patients, demand and access.</p></div>
        <div className="about-card"><h3>Data sources</h3><p>{SOURCES.map((s) => `${s.label} (${s.detail})`).join(' · ')}</p></div>
        <div className="about-card"><h3>How to start</h3><p>Go to <strong>Summary</strong>, pick a source, then tick fields and measures to build a table.</p></div>
      </div>
      <section className="about-table">
        <h3>Measures</h3>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Measure</th><th>Definition</th><th>Source</th><th>Defined in</th></tr></thead>
            <tbody>
              {MEASURES.map((m) => (
                <tr key={m.id} className={m.origin === 'Existing Insights Accelerator' ? 'flag' : ''}>
                  <td><strong>{m.label}</strong></td>
                  <td>{m.definition}</td>
                  <td>{SOURCES.find((s) => s.id === m.source)?.label}</td>
                  <td>{m.origin}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">Highlighted rows come from the existing Insights Accelerator and still need an agreed definition.</p>
      </section>
    </div>
  );
}
