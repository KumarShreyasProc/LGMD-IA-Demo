import { useMemo, useState } from 'react';
import type { Row, Value } from '../data/api';

interface Props {
  fields: string[];          // row hierarchy, outer → inner
  fieldLabels: string[];
  measures: string[];
  measureLabels: string[];
  levels: Row[][];           // levels[k]: rows grouped by fields[0..k] (+ the column field), from the backend
  column?: { name: string; values: Value[] }; // matrix columns (values already limited to the ones shown)
  rowTotals?: Row[][];       // with a column: levels[k] grouped by fields[0..k] only → "Total" column
  columnTotals?: Row[];      // with a column: grouped by the column only → footer per column
  grand?: Row;               // no dimensions → grand total
  format: (value: Value, name: string) => string;
}

interface Node { key: string; value: Value; total: Row; cells: Map<string, Row>; children: Node[] }
type Sort = { col: string; measure: string | null; dir: 1 | -1 }; // measure null = sort by the row labels

const TOTAL = '__total';
const keyOf = (path: Value[]) => JSON.stringify(path);

function compare(x: Value, y: Value, blanksFirst: boolean) {
  if (x === null || y === null) return x === y ? 0 : (x === null) === blanksFirst ? -1 : 1;
  return typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
}

/** Nodes come from the row totals; with a column, each node also gets one cell per column value. */
function buildTree(fields: string[], nodeLevels: Row[][], column?: { name: string; levels: Row[][] }): Node[] {
  const byKey = new Map<string, Node>();
  const roots: Node[] = [];
  nodeLevels.forEach((rows, depth) => {
    for (const row of rows) {
      const path = fields.slice(0, depth + 1).map((f) => row[f] ?? null);
      const node: Node = { key: keyOf(path), value: path[depth], total: row, cells: new Map(), children: [] };
      byKey.set(node.key, node);
      if (depth === 0) roots.push(node);
      else byKey.get(keyOf(path.slice(0, -1)))?.children.push(node); // parent cut off by the row limit: skipped
    }
  });
  column?.levels.forEach((rows, depth) => {
    for (const row of rows) {
      const node = byKey.get(keyOf(fields.slice(0, depth + 1).map((f) => row[f] ?? null)));
      node?.cells.set(keyOf([row[column.name] ?? null]), row);
    }
  });
  return roots;
}

/** Power BI matrix (stepped layout): each field is a level with +/− to drill down; subtotals on every level. */
export function Matrix({ fields, fieldLabels, measures, measureLabels, levels, column, rowTotals, columnTotals, grand, format }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<Sort>({ col: TOTAL, measure: null, dir: 1 }); // Power BI default: row labels A→Z, blanks first

  const pivot = !!column && !!rowTotals;
  const tree = useMemo(
    () => (pivot ? buildTree(fields, rowTotals!, { name: column!.name, levels }) : buildTree(fields, levels)),
    [fields, levels, rowTotals, column, pivot],
  );
  const drillable = fields.length > 1;
  // Column groups: one per shown column value, then Total (the only group without a column).
  const groups = pivot
    ? [...column!.values.map((v) => ({ key: keyOf([v]), label: format(v, column!.name) })), { key: TOTAL, label: 'Total' }]
    : [{ key: TOTAL, label: '' }];
  const footer = new Map((columnTotals ?? []).map((r) => [keyOf([r[column!.name] ?? null]), r]));
  const cell = (node: Node, col: string, m: string) => (col === TOTAL ? node.total[m] : node.cells.get(col)?.[m]) ?? null;

  const visible = useMemo(() => {
    const cmp = (a: Node, b: Node) => sort.measure === null
      ? compare(a.value, b.value, true) * sort.dir
      : compare(cell(a, sort.col, sort.measure), cell(b, sort.col, sort.measure), false) * sort.dir; // blank measures last
    const out: { node: Node; depth: number }[] = [];
    const walk = (nodes: Node[], depth: number) => {
      for (const node of [...nodes].sort(cmp)) {
        out.push({ node, depth });
        if (expanded.has(node.key)) walk(node.children, depth + 1);
      }
    };
    walk(tree, 0);
    return out;
  }, [tree, expanded, sort]); // `cell` only reads the nodes in `tree`

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
  const clickHeader = (col: string, measure: string | null) =>
    setSort(sort.col === col && sort.measure === measure ? { col, measure, dir: (sort.dir * -1) as 1 | -1 } : { col, measure, dir: measure === null ? 1 : -1 });
  const active = (col: string, measure: string | null) => sort.col === col && sort.measure === measure;
  const ariaSort = (col: string, measure: string | null) => (active(col, measure) ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none');
  const arrow = (col: string, measure: string | null) => (active(col, measure) ? (sort.dir === 1 ? ' ▲' : ' ▼') : '');
  const sortable = (col: string, m: string, text: string, key: string) => (
    <th key={key} className="num" aria-sort={ariaSort(col, m)}>
      <button type="button" onClick={() => clickHeader(col, m)}>{text}{arrow(col, m)}</button>
    </th>
  );
  const labelHeader = (
    <th aria-sort={ariaSort(TOTAL, null)} rowSpan={pivot && measures.length > 1 ? 2 : 1}>
      <button type="button" onClick={() => clickHeader(TOTAL, null)}>{fieldLabels.join(' › ')}{arrow(TOTAL, null)}</button>
    </th>
  );

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
            {!pivot ? (
              <tr>{labelHeader}{measures.map((m, i) => sortable(TOTAL, m, measureLabels[i], m))}</tr>
            ) : measures.length === 1 ? (
              <tr>{labelHeader}{groups.map((g) => sortable(g.key, measures[0], g.label, g.key))}</tr>
            ) : (
              <>
                <tr>{labelHeader}{groups.map((g) => <th key={g.key} className="group" colSpan={measures.length}>{g.label}</th>)}</tr>
                <tr className="sub">{groups.flatMap((g) => measures.map((m, i) => sortable(g.key, m, measureLabels[i], `${g.key}|${m}`)))}</tr>
              </>
            )}
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
                  {groups.flatMap((g) => measures.map((m) => <td key={`${g.key}|${m}`} className="num">{format(cell(node, g.key, m), m)}</td>))}
                </tr>
              );
            })}
          </tbody>
          {grand && (
            <tfoot>
              <tr>
                <td>Total</td>
                {groups.flatMap((g) => measures.map((m) => (
                  <td key={`${g.key}|${m}`} className="num">{format((g.key === TOTAL ? grand[m] : footer.get(g.key)?.[m]) ?? null, m)}</td>
                )))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
