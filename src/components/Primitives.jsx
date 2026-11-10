import { Check, CircleCheck, Clock3, LoaderCircle, Square, TriangleAlert } from 'lucide-react';
import { number, percent, stateInfo } from '../lib/data.js';

export function StatusIcon({state, size = 20}) {
  const Icon = state === 'complete' ? CircleCheck : state === 'running' ? LoaderCircle
    : state === 'failed' ? TriangleAlert : Clock3;
  return <Icon size={size} strokeWidth={1.8} className={`status-icon ${state}`} aria-hidden="true" />;
}
export function StateBadge({run}) {
  const state = stateInfo(run);
  return <span className={`state-badge ${state.tone}`}>{state.label}</span>;
}
export function ProgressBar({value, label}) {
  const known = Number.isFinite(value);
  return <div className="progress-track" role="progressbar" aria-label={label}
    aria-valuenow={known ? Number((value * 100).toFixed(1)) : undefined}
    aria-valuemin="0" aria-valuemax="100" aria-valuetext={known ? percent(value, 1) : 'Not yet available'}>
    <span style={{width: known ? `${Math.max(0, Math.min(100, value * 100))}%` : '0%'}} />
  </div>;
}
export function EmptyState({children = 'Waiting for recorded experiment data.'}) {
  return <p className="empty-state">{children}</p>;
}
export function TableWrap({label, children}) {
  return <div className="table-scroll" role="region" aria-label={label} tabIndex="0">{children}</div>;
}
export function SectionHeading({title, note, action}) {
  return <div className="section-heading"><div><h2>{title}</h2>{note && <p>{note}</p>}</div>{action}</div>;
}
export function AssignmentChecklist({rows}) {
  return <section className="assignment-checklist" aria-labelledby="checklist-heading">
    <h2 id="checklist-heading">Assignment checklist</h2>
    <ul>{rows.map(row => <li key={row.title}>
      {row.title.startsWith('Report') && row.status === 'pending' ? <Square size={20} aria-hidden="true" />
        : <StatusIcon state={row.status} />}
      <span>{row.title} <strong className={row.status}>{row.note}</strong></span>
    </li>)}</ul>
  </section>;
}
export function ChecksCount({passed, total}) {
  return <span className="checks-count"><Check size={20} aria-hidden="true" />
    <strong>{number(passed)}</strong> {Number.isFinite(total) && total !== passed ? `of ${number(total)} checks passed` : 'checks passed'}
  </span>;
}
