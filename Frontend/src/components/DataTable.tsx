import { useMemo, useState } from 'react';

interface Props {
  columns: string[];
  rows: (string | number)[][];
  total?: (string | number)[];
  pageSize?: number;
  numericFrom?: number; // columns at or after this index are right-aligned
}

/** Blue-header table with sorting and paging, like the Power BI table visual. */
export function DataTable({ columns, rows, total, pageSize = 15, numericFrom = 1 }: Props) {
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    return [...rows].sort((a, b) => {
      const x = a[sort.col], y = b[sort.col];
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir;
    });
  }, [rows, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const view = sorted.slice(page * pageSize, page * pageSize + pageSize);
  const clickHeader = (i: number) => setSort(sort?.col === i ? { col: i, dir: (sort.dir * -1) as 1 | -1 } : { col: i, dir: -1 });

  return (
    <div className="table-wrap">
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((c, i) => (
                <th key={c} className={i >= numericFrom ? 'num' : ''} aria-sort={sort?.col === i ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" onClick={() => clickHeader(i)}>
                    {c}{sort?.col === i ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.map((r, ri) => (
              <tr key={ri}>{r.map((v, i) => <td key={i} className={i >= numericFrom ? 'num' : ''}>{v}</td>)}</tr>
            ))}
          </tbody>
          {total && (
            <tfoot><tr>{total.map((v, i) => <td key={i} className={i >= numericFrom ? 'num' : ''}>{v}</td>)}</tr></tfoot>
          )}
        </table>
      </div>
      {pages > 1 && (
        <div className="pager">
          <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page + 1} of {pages} · {rows.length.toLocaleString()} rows</span>
          <button type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}

export function downloadCsv(filename: string, columns: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [columns.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
