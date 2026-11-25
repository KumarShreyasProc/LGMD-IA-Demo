import { useMemo, useState } from 'react';
import { formatValue, type Value } from '../data/api';

interface Props {
  columns: string[];
  rows: Value[][]; // raw values: sorting is numeric/text on these, display uses `format`
  format?: (value: Value, column: number) => string;
  total?: string[];
  pageSize?: number;
  numericFrom?: number; // columns at or after this index are right-aligned
}

function compare(x: Value, y: Value) {
  return typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
}

/** Blue-header table with sorting and paging, like the Power BI table visual. */
export function DataTable({ columns, rows, format = (v) => formatValue(v), total, pageSize = 15, numericFrom = 1 }: Props) {
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    return [...rows].sort((a, b) => {
      const x = a[sort.col], y = b[sort.col];
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1; // blanks last
      return compare(x, y) * sort.dir;
    });
  }, [rows, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pages - 1); // new data can have fewer pages
  const view = sorted.slice(current * pageSize, current * pageSize + pageSize);
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
              <tr key={ri}>{r.map((v, i) => <td key={i} className={i >= numericFrom ? 'num' : ''}>{format(v, i)}</td>)}</tr>
            ))}
          </tbody>
          {total && (
            <tfoot><tr>{total.map((v, i) => <td key={i} className={i >= numericFrom ? 'num' : ''}>{v}</td>)}</tr></tfoot>
          )}
        </table>
      </div>
      {pages > 1 && (
        <div className="pager">
          <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</button>
          <span>Page {current + 1} of {pages} · {rows.length.toLocaleString()} rows</span>
          <button type="button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}

export function downloadCsv(filename: string, columns: string[], rows: string[][]) {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const csv = [columns.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
