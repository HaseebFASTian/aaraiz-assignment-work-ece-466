import { ArrowUpRight } from 'lucide-react';
import { AccuracyBars } from './Charts.jsx';
import { AssignmentChecklist, EmptyState, ProgressBar, SectionHeading, StateBadge, TableWrap } from './Primitives.jsx';
import { checklist, isComplete, label, number, percent, progressRatio, stateInfo } from '../lib/data.js';

export function CaptionTable({runs, onSelect, detailed = false}) {
  if (!runs.length) return <EmptyState>Caption run status is not available yet.</EmptyState>;
  return <TableWrap label="Image-captioning training progress"><table className="caption-table">
    <thead><tr><th>Model</th><th>Progress (batches)</th><th className="align-right">Percent</th>
      {detailed && <><th className="align-right">Online loss</th><th className="align-right">Perplexity</th></>}
      <th>Status</th></tr></thead>
    <tbody>{runs.map(run => {
      const p = run.progress || {};
      const ratio = progressRatio(run);
      const last = run.history?.at(-1);
      return <tr key={run.id}>
        <th scope="row"><button className="model-link" onClick={() => onSelect(run)}>{label(run)}</button></th>
        <td className="batch-progress"><span className="numeric">{number(p.completed_batches ?? (isComplete(run) ? last?.batches : null))}
          <span className="muted"> / </span>{number(p.total_batches ?? last?.batches)}</span>
          <ProgressBar value={ratio} label={`${label(run)} completed batches`} /></td>
        <td className="align-right numeric">{percent(ratio, 1)}</td>
        {detailed && <><td className="align-right numeric">{number(isComplete(run) ? last?.loss : p.loss, 4)}</td>
          <td className="align-right numeric">{number(isComplete(run) ? last?.perplexity : p.perplexity, 3)}</td></>}
        <td><StateBadge run={run} /></td>
      </tr>;
    })}</tbody>
  </table></TableWrap>;
}

export function ActivityFeed({snapshot, expanded = false}) {
  const runs = snapshot?.caption_runs || [];
  const jobs = snapshot?.jobs || [];
  const rows = jobs.length ? jobs.map(job => ({label: job.label, state: job.state, failed: job.failed, elapsed: job.elapsed}))
    : runs.map(run => ({label: label(run), state: stateInfo(run).label, failed: stateInfo(run).tone === 'failed'}));
  const visible = expanded ? rows : rows.slice(0, 4);
  return <section className={`activity-feed ${expanded ? 'expanded' : ''}`} aria-labelledby={expanded ? 'all-activity-title' : 'activity-title'}>
    <h2 id={expanded ? 'all-activity-title' : 'activity-title'}>Server activity</h2>
    {!rows.length ? <p className="feed-empty">No current server state is available.</p> : <ul>{visible.map((row, index) =>
      <li key={`${row.label}-${index}`}><span className={`feed-state ${row.failed ? 'failed' : /run/i.test(row.state) ? 'running' : ''}`}>
        {String(row.state || 'pending').replaceAll('_', ' ')}</span><span>{row.label || 'Experiment'}
          {expanded && row.elapsed && <small>Elapsed {row.elapsed}</small>}</span></li>)}</ul>}
    {!snapshot?.predictions?.length && !jobs.some(job => job.label === 'Caption comparison')
      && <div className="feed-queued"><span>PENDING</span><span>Four-image comparison</span></div>}
  </section>;
}

export function ModelConfiguration({snapshot, onSelect}) {
  const runs = [...(snapshot?.sentiment_runs || []), ...(snapshot?.caption_runs || [])];
  return <section className="configuration-section">
    <SectionHeading title="Model configuration" note="Experiment settings for the current runs." />
    {!runs.length ? <EmptyState /> : <TableWrap label="Model configurations"><table>
      <thead><tr><th>Model</th><th>Task</th><th>Input</th><th>Hidden size</th><th>Layers</th><th>Recurrent dropout</th><th>Runtime</th></tr></thead>
      <tbody>{runs.map(run => {
        const caption = (snapshot?.caption_runs || []).some(item => item.id === run.id);
        const config = run.config || {};
        return <tr key={run.id}><th scope="row"><button className="model-link" onClick={() => onSelect(run)}>{label(run)}</button></th>
          <td>{caption ? 'Captioning' : 'Sentiment'}</td><td>{caption ? '224 × 224 images' : '80 tokens'}</td>
          <td className="numeric">{number(config.hidden_size ?? (caption ? 512 : 164))}</td>
          <td className="numeric">{number(config.num_layers ?? 1)}</td><td className="numeric">{number(config.dropout ?? 0)}</td>
          <td>{caption ? (config.channels_last === true ? 'CPU · FP32 · channels last' : config.channels_last === false ? 'CPU · FP32 · contiguous' : 'CPU · FP32 · layout pending') : 'CPU · FP32'}</td></tr>;
      })}</tbody>
    </table></TableWrap>}
  </section>;
}

export default function Overview({snapshot, evidence, onSelect, onNavigate}) {
  const captions = snapshot?.caption_runs || [];
  const sentiment = snapshot?.sentiment_runs || [];
  const epochs = captions.map(run => run.progress?.epoch ?? run.completed_epochs).filter(Number.isFinite);
  return <>
    <div className="overview-primary ruled-section">
      <section className="caption-region">
        <SectionHeading title="Image captioning" note={captions.length === 3 && captions.every(isComplete) ? 'Full epoch complete · all three models'
          : epochs.length ? `Training · epoch ${Math.max(...epochs)} of 1` : 'Waiting for training status'} />
        <CaptionTable runs={captions} onSelect={onSelect} />
        <p className="figure-note">Interim token-weighted loss; final metrics after the full epoch.</p>
      </section>
      <AssignmentChecklist rows={checklist(snapshot, evidence)} />
    </div>
    <div className="overview-secondary ruled-section">
      <section className="sentiment-region">
        <SectionHeading title="Sentiment test accuracy" />
        <AccuracyBars runs={sentiment} onSelect={onSelect} />
        <p className="figure-note">5,000 reviews · course 90/10 split</p>
      </section>
      <ActivityFeed snapshot={snapshot} />
    </div>
    <ModelConfiguration snapshot={snapshot} onSelect={onSelect} />
    <button className="text-link section-link" onClick={() => onNavigate('models')}>Explore measured results <ArrowUpRight size={16} aria-hidden="true" /></button>
  </>;
}
