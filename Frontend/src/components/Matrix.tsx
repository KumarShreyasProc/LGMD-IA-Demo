import { useMemo, useState } from 'react';
import type { Row, Value } from '../data/api';

interface Props {
  fields: string[];          // row hierarchy, outer → inner
  fieldLabels: string[];
  measures: string[];
  measureLabels: string[];
  levels: Row[][];           // levels[k]: rows grouped by fields[0..k], so subtotals come from the backend
  format: (value: Value, name: string) => string;
  total?: string[];          // formatted grand total per measure
}

interface Node { key: string; value: Value; row: Row; children: Node[] }
type Sort = { by: string | null; dir: 1 | -1 }; // by = measure name, or null for the row labels

const keyOf = (path: Value[]) => JSON.stringify(path);

function compare(x: Value, y: Value, blanksFirst: boolean) {
  if (x === null || y === null) return x === y ? 0 : (x === null) === blanksFirst ? -1 : 1;
  return typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
}

function buildTree(fields: string[], levels: Row[][]): Node[] {
  const byKey = new Map<string, Node>();
  const roots: Node[] = [];
  levels.forEach((rows, depth) => {
    for (const row of rows) {
      const path = fields.slice(0, depth + 1).map((f) => row[f] ?? null);
      const node: Node = { key: keyOf(path), value: path[depth], row, children: [] };
      byKey.set(node.key, node);
      if (depth === 0) roots.push(node);
      else byKey.get(keyOf(path.slice(0, -1)))?.children.push(node); // parent cut off by the row limit: skipped
    }
  });
  return roots;
}

/** Power BI matrix (stepped layout): each field is a level with +/− to drill down, subtotals on every level. */
export function Matrix({ fields, fieldLabels, measures, measureLabels, levels, format, total }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<Sort>({ by: null, dir: 1 }); // Power BI default: row labels A→Z, blanks first

  const tree = useMemo(() => buildTree(fields, levels), [fields, levels]);
  const drillable = fields.length > 1;

  const visible = useMemo(() => {
    const cmp = (a: Node, b: Node) => sort.by === null
      ? compare(a.value, b.value, true) * sort.dir
      : compare(a.row[sort.by] ?? null, b.row[sort.by] ?? null, false) * sort.dir; // blank measures last
    const out: { node: Node; depth: number }[] = [];
    const walk = (nodes: Node[], depth: number) => {
      for (const node of [...nodes].sort(cmp)) {
        out.push({ node, depth });
        if (expanded.has(node.key)) walk(node.children, depth + 1);
      }
    };
    walk(tree, 0);
    return out;
  }, [tree, expanded, sort]);

  const toggle = (key: string) => {
    const next = new Set(expanded);
    if (!next.delete(key)) next.add(key);
    setExpanded(next);
  };
  const expandAll = () => {
    const keys = new Set<string>();
    const walk = (nodes: Node[]) => nodes.forEach((n) => { if (n.children.length) { keys.add(n.key); walk(n.children); } });
    walk(tree);
    setExpanded(keys);
  };
  const clickHeader = (by: string | null) =>
    setSort(sort.by === by ? { by, dir: (sort.dir * -1) as 1 | -1 } : { by, dir: by === null ? 1 : -1 });
  const ariaSort = (by: string | null) => (sort.by === by ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none');
  const arrow = (by: string | null) => (sort.by === by ? (sort.dir === 1 ? ' ▲' : ' ▼') : '');

  return (
    <div className="table-wrap matrix">
      {drillable && (
        <div className="matrix-tools">
          <button type="button" className="link" onClick={expandAll}>Expand all</button>
          <button type="button" className="link" onClick={() => setExpanded(new Set())}>Collapse all</button>
        </div>
      )}
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th aria-sort={ariaSort(null)}>
                <button type="button" onClick={() => clickHeader(null)}>{fieldLabels.join(' › ')}{arrow(null)}</button>
              </th>
              {measures.map((m, i) => (
                <th key={m} className="num" aria-sort={ariaSort(m)}>
                  <button type="button" onClick={() => clickHeader(m)}>{measureLabels[i]}{arrow(m)}</button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map(({ node, depth }) => {
              const label = format(node.value, fields[depth]);
              const open = expanded.has(node.key);
              const parent = depth < fields.length - 1;
              return (
                <tr key={node.key} className={parent && drillable ? 'subtotal' : ''}>
                  <td style={{ paddingLeft: 8 + depth * 18 }}>
                    {parent ? (
                      <button type="button" className="drill" aria-expanded={open} disabled={!node.children.length}
                        aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`} onClick={() => toggle(node.key)}>
                        {open ? '−' : '+'}
                      </button>
                    ) : drillable && <span className="drill-spacer" />}
                    {label}
                  </td>
                  {measures.map((m) => <td key={m} className="num">{format(node.row[m] ?? null, m)}</td>)}
                </tr>
              );
            })}
          </tbody>
          {total && (
            <tfoot><tr><td>Total</td>{total.map((v, i) => <td key={i} className="num">{v}</td>)}</tr></tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
