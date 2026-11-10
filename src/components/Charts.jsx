import { useId, useMemo } from 'react';
import { EmptyState } from './Primitives.jsx';
import { isComplete, label, number, percent } from '../lib/data.js';

export function AccuracyBars({runs, onSelect}) {
  const measured = runs.filter(run => isComplete(run) && Number.isFinite(run.test_accuracy));
  if (!measured.length) return <EmptyState>Completed test accuracies will appear here after evaluation.</EmptyState>;
  return <div className="accuracy-chart" role="group" aria-label="Sentiment test accuracy, zero to one hundred percent">
    {measured.map(run => <button className="accuracy-row" key={run.id} onClick={() => onSelect(run)}
      aria-label={`${label(run)}: ${percent(run.test_accuracy)} test accuracy. View model details.`}>
      <span className="accuracy-label">{label(run)}</span>
      <span className="accuracy-plot"><span style={{width: `${run.test_accuracy * 100}%`}} /></span>
      <span className="numeric">{percent(run.test_accuracy)}</span>
    </button>)}
  </div>;
}

export function HistoryChart({history, metric = 'loss', title = 'Recorded training loss'}) {
  const id = useId();
  const points = useMemo(() => (history || []).filter(row => Number.isFinite(row.epoch) && Number.isFinite(row[metric]))
    .map(row => ({x: row.epoch, y: row[metric]})), [history, metric]);
  if (!points.length) return <EmptyState>No recorded epoch history is available for this metric yet.</EmptyState>;
  const width = 620, height = 240, left = 50, top = 18, right = 20, bottom = 42;
  const minX = Math.min(...points.map(p => p.x));
  const maxX = Math.max(...points.map(p => p.x));
  const low = Math.min(...points.map(p => p.y));
  const high = Math.max(...points.map(p => p.y));
  const padding = Math.max((high - low) * 0.12, high * 0.03, 0.01);
  const minY = Math.max(0, low - padding), maxY = high + padding;
  const x = value => left + ((value - minX) / (maxX - minX || 1)) * (width - left - right);
  const y = value => height - bottom - ((value - minY) / (maxY - minY || 1)) * (height - top - bottom);
  const path = points.map((point, index) => `${index ? 'L' : 'M'}${x(point.x)},${y(point.y)}`).join(' ');
  const display = value => metric === 'accuracy' ? percent(value, 0) : number(value, 2);
  return <figure className="history-chart">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-title ${id}-description`}>
      <title id={`${id}-title`}>{title}</title>
      <desc id={`${id}-description`}>{points.length} recorded epochs. First: {display(points[0].y)};
        latest: {display(points[points.length - 1].y)}. The vertical axis spans {display(minY)} to {display(maxY)}.</desc>
      {[0, 0.5, 1].map(fraction => {
        const value = minY + (maxY - minY) * fraction;
        return <g key={fraction}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} className="chart-grid" />
          <text x={left - 10} y={y(value) + 4} textAnchor="end">{display(value)}</text></g>;
      })}
      <path d={path} className="chart-line" />
      {points.map(point => <circle key={point.x} cx={x(point.x)} cy={y(point.y)} r="3" className="chart-dot">
        <title>Epoch {point.x}: {display(point.y)}</title></circle>)}
      {[...new Set([minX, maxX])].map(value => <text key={value} x={x(value)} y={height - bottom + 23} textAnchor="middle">{value}</text>)}
      <text x={width / 2} y={height - 3} textAnchor="middle">Epoch</text>
    </svg>
    <figcaption>{title} · observed epoch values only.</figcaption>
  </figure>;
}
