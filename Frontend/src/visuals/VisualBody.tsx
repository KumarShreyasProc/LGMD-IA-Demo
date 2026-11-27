import type { ReactElement } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { formatValue, type FieldMeta, type Value } from '../data/api';
import { CARD_BG, INK, SERIES } from '../config/palette';
import { DataTable } from '../components/DataTable';
import { Matrix } from '../components/Matrix';
import { isChart, isPie, type VisualConfig } from './config';
import { chartModel, displayValue, visualNotes, type ChartModel, type VisualData } from './data';

const axis = { fontSize: 11, fill: '#605E5C' };
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const tickFormat = (field?: FieldMeta) => (v: number) =>
  field?.format === 'percentage' ? `${Math.round(v * 1000) / 10}%` : compact.format(v);
const legendText = (value: string) => <span style={{ color: INK }}>{value}</span>;

/** Renders a personalized visual's data as a table, matrix or chart, with notes on anything left out. */
export function VisualBody({ data, label }: { data: VisualData; label: (name: string) => string }) {
  const { config, fields } = data;
  const fmt = (v: Value, name: string) =>
    fields[name]?.type === 'measure' ? formatValue(v, fields[name]) : displayValue(v, name, fields[name]);
  if (!data.leaf.length) return <p className="muted pad">No rows match these filters.</p>;

  let body: ReactElement;
  if (config.type === 'table') {
    const names = [...config.rows, ...(config.columns ? [config.columns] : []), ...config.values];
    const dims = names.length - config.values.length;
    body = (
      <DataTable columns={names.map(label)} rows={data.leaf.map((r) => names.map((n) => r[n] ?? null))} format={(v, i) => fmt(v, names[i])}
        total={data.grand && names.map((n, i) => (i === 0 ? 'Total' : i < dims ? '' : fmt(data.grand![n] ?? null, n)))}
        numericFrom={dims} pageSize={12} />
    );
  } else if (config.type === 'matrix') {
    body = (
      <Matrix key={JSON.stringify(config)} fields={config.rows} fieldLabels={config.rows.map(label)} measures={config.values}
        measureLabels={config.values.map(label)} levels={data.levels} format={fmt} grand={data.grand}
        column={config.columns ? { name: config.columns, values: data.columnValues } : undefined}
        rowTotals={config.columns ? data.rowTotals : undefined} columnTotals={data.columnTotals} />
    );
  } else {
    const model = chartModel(data);
    const name = (key: string) => {
      const s = model.series.find((x) => x.key === key);
      return !s ? key : config.columns && !isPie(config.type) ? s.name : label(s.name);
    };
    body = (
      <div className="visual-plot">
        <ResponsiveContainer width="100%" height="100%">{renderChart(config, model, name)}</ResponsiveContainer>
      </div>
    );
  }
  return (
    <div className={`visual ${isChart(config.type) ? 'is-chart' : ''}`}>
      {body}
      {visualNotes(data, label).map((n) => <p key={n} className="muted visual-note">{n}</p>)}
    </div>
  );
}

function renderChart(config: VisualConfig, model: ChartModel, name: (key: string) => string): ReactElement {
  const fieldOf = (key: unknown) => model.series.find((s) => s.key === key)?.field;
  const tooltip = <Tooltip formatter={(value: unknown, _n: unknown, item: { dataKey?: unknown }) => formatValue(value as Value, fieldOf(item.dataKey))} />;
  const legend = <Legend wrapperStyle={{ fontSize: 11 }} formatter={legendText} />;
  const grid = <CartesianGrid vertical={false} stroke="#EDEDED" />;
  const valueTick = tickFormat(model.series[0]?.field);
  const last = model.series.length - 1;

  switch (config.type) {
    case 'clustered-column':
    case 'stacked-column': {
      const stacked = config.type === 'stacked-column';
      return (
        <BarChart data={model.rows}>{grid}<XAxis dataKey="label" tick={axis} /><YAxis tick={axis} tickFormatter={valueTick} />{tooltip}{legend}
          {model.series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={name(s.key)} fill={SERIES[i]} stroke={CARD_BG} stackId={stacked ? 'v' : undefined}
              radius={!stacked || i === last ? [4, 4, 0, 0] : undefined} />
          ))}</BarChart>
      );
    }
    case 'clustered-bar':
    case 'stacked-bar': {
      const stacked = config.type === 'stacked-bar';
      return (
        <BarChart data={model.rows} layout="vertical"><CartesianGrid horizontal={false} stroke="#EDEDED" />
          <XAxis type="number" tick={axis} tickFormatter={valueTick} /><YAxis type="category" dataKey="label" tick={axis} width={140} />{tooltip}{legend}
          {model.series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={name(s.key)} fill={SERIES[i]} stroke={CARD_BG} stackId={stacked ? 'v' : undefined}
              radius={!stacked || i === last ? [0, 4, 4, 0] : undefined} />
          ))}</BarChart>
      );
    }
    case 'line':
      return (
        <LineChart data={model.rows}>{grid}<XAxis dataKey="label" tick={axis} /><YAxis tick={axis} tickFormatter={valueTick} />{tooltip}{legend}
          {model.series.map((s, i) => (
            <Line key={s.key} dataKey={s.key} name={name(s.key)} stroke={SERIES[i]} strokeWidth={2} dot={model.rows.length <= 24 ? { r: 4 } : false} connectNulls />
          ))}</LineChart>
      );
    case 'area':
      return (
        <AreaChart data={model.rows}>{grid}<XAxis dataKey="label" tick={axis} /><YAxis tick={axis} tickFormatter={valueTick} />{tooltip}{legend}
          {model.series.map((s, i) => (
            <Area key={s.key} dataKey={s.key} name={name(s.key)} stroke={SERIES[i]} fill={SERIES[i]} fillOpacity={0.2} strokeWidth={2} connectNulls />
          ))}</AreaChart>
      );
    default: { // pie / donut: slices are the row values, sized by the first value
      const field = model.series[0]?.field;
      return (
        <PieChart>
          <Tooltip formatter={(value: unknown) => formatValue(value as Value, field)} />
          <Legend wrapperStyle={{ fontSize: 11 }} formatter={legendText} />
          <Pie data={model.rows} dataKey="s0" nameKey="label" innerRadius={config.type === 'donut' ? '55%' : 0} outerRadius="80%"
            stroke={CARD_BG} strokeWidth={2} isAnimationActive={false}
            label={({ value, percent }: { value: number; percent: number }) => `${formatValue(value, field)} (${(percent * 100).toFixed(1)}%)`}>
            {model.rows.map((r, i) => <Cell key={String(r.label)} fill={SERIES[i]} />)}
          </Pie>
        </PieChart>
      );
    }
  }
}
