import { ArrowRight, Check, CircleCheck, Clock3, Layers, Monitor, Play, ShieldCheck, Square, TriangleAlert } from 'lucide-react';
import { EmptyState, ProgressBar, SectionHeading, StateBadge, TableWrap } from './Primitives.jsx';
import { allRuns, catalogSentimentRuns, checklist, isComplete, label, number, percent, progressRatio, stateInfo } from '../lib/data.js';

export function CaptionTable({runs, onSelect, detailed = false, compact = false}) {
  if (!runs.length) return <EmptyState>Caption run status is not available yet.</EmptyState>;
  return <TableWrap label="Image-captioning training progress"><table className="caption-table">
    <thead><tr><th>Model</th><th>{compact ? 'Training progress' : 'Progress (batches)'}</th>
      {!compact && <th className="align-right">Percent</th>}
      {detailed && <><th className="align-right">Online loss</th><th className="align-right">Perplexity</th></>}
      <th>Status</th></tr></thead>
    <tbody>{runs.map(run => {
      const p = run.progress || {}, last = run.history?.at(-1);
      return <tr key={run.id}>
        <th scope="row"><button className="model-link" onClick={() => onSelect(run)}>{label(run)}</button></th>
        <td className="batch-progress"><span>{number(p.completed_batches ?? (isComplete(run) ? last?.batches : null))}
          <span className="muted"> / </span>{number(p.total_batches ?? last?.batches)}</span>
          <ProgressBar value={progressRatio(run)} label={`${label(run)} completed batches`} /></td>
        {!compact && <td className="align-right numeric">{percent(progressRatio(run), 1)}</td>}
        {detailed && <><td className="align-right numeric">{number(isComplete(run) ? last?.loss : p.loss, 4)}</td>
          <td className="align-right numeric">{number(isComplete(run) ? last?.perplexity : p.perplexity, 3)}</td></>}
        <td><StateBadge run={run} /></td>
      </tr>;
    })}</tbody>
  </table></TableWrap>;
}

export function ActivityFeed({snapshot, expanded = false}) {
  const jobs = snapshot?.jobs || [];
  const captions = snapshot?.caption_runs || [];
  const running = captions.filter(run => stateInfo(run).tone === 'running');
  const queued = jobs.filter(job => job.state === 'queued');
  const failed = jobs.filter(job => job.failed || job.state === 'failed');
  const complete = captions.filter(isComplete);
  const groups = [
    {id: 'running', title: 'Running models', rows: running.map(label), Icon: Monitor},
    {id: 'queued', title: 'Queued', rows: queued.map(job => job.label === 'Caption comparison' ? 'Model comparison (Q2d)' : job.label), Icon: Layers},
    {id: 'failed', title: 'Needs attention', rows: failed.map(job => job.label), Icon: TriangleAlert},
    {id: 'complete', title: 'Completed models', rows: complete.map(label), Icon: CircleCheck},
  ].filter(group => group.rows.length);
  return <section className={`surface activity-feed ${expanded ? 'expanded' : ''}`}>
    <h2>{expanded ? 'Job status' : 'Server activity'}</h2>
    {!groups.length ? <EmptyState>No current server state is available.</EmptyState> : <ul className="activity-groups">
      {groups.map(({id, title, rows, Icon}) => <li key={id}>
        <span className={`activity-icon ${id}`}><Icon size={23} aria-hidden="true" /></span>
        <div><strong>{title}: {rows.length}</strong><p>{rows.join(', ')}</p></div>
      </li>)}
    </ul>}
    {expanded && jobs.length > 0 && <TableWrap label="Observed scheduler states"><table>
      <thead><tr><th>Task</th><th>State</th><th>Elapsed</th></tr></thead><tbody>{jobs.map((job, index) =>
        <tr key={`${job.label}-${index}`}><td>{job.label}</td><td><StateBadge run={{state: job.state, completed: job.state === 'complete'}} /></td>
          <td className="numeric">{job.elapsed || '—'}</td></tr>)}</tbody></table></TableWrap>}
  </section>;
}

export function ModelConfiguration({snapshot, evidence, onSelect}) {
  const live = allRuns(snapshot);
  const sentiment = catalogSentimentRuns(evidence);
  const caption = (evidence?.captioning?.variants || []).map(run => ({id: run.id, label: run.label, state: 'unavailable',
    config: {backbone: run.backbone, cell: run.decoder, channels_last: run.memory_format === 'channels_last'}}));
  const runs = [...sentiment, ...caption].map(run => ({...run, ...live.find(item => item.id === run.id),
    config: {...run.config, ...live.find(item => item.id === run.id)?.config}}));
  const visible = runs.length ? runs : live;
  return <section className="surface configuration-section">
    <SectionHeading title="Model configuration" note="The architecture and runtime used for each experiment." />
    {!visible.length ? <EmptyState /> : <TableWrap label="Model configurations"><table>
      <thead><tr><th>Model</th><th>Task</th><th>Input</th><th>Embedding</th><th>Hidden</th><th>Layers</th><th>Runtime</th></tr></thead>
      <tbody>{visible.map(run => {
        const isCaption = ['baseline', 'alternate_encoder', 'simple_rnn'].includes(run.id);
        const config = run.config || {};
        return <tr key={run.id}><th scope="row"><button className="model-link" onClick={() => onSelect(run)}>{label(run)}</button></th>
          <td>{isCaption ? 'Captioning' : 'Sentiment'}</td><td>{isCaption ? '224 × 224 images' : '80 tokens'}</td>
          <td>{number(config.embedding_dim ?? (isCaption ? 512 : run.id.endsWith('100') ? 100 : 10))}</td>
          <td>{number(config.hidden_size ?? (isCaption ? 512 : 164))}</td><td>{number(config.num_layers ?? 1)}</td>
          <td>{isCaption ? (config.channels_last === true ? 'CPU · FP32 · channels last' : config.channels_last === false ? 'CPU · FP32 · contiguous' : 'CPU · FP32 · layout pending') : 'CPU · FP32'}</td></tr>;
      })}</tbody>
    </table></TableWrap>}
  </section>;
}

function ExperimentRing({snapshot, evidence}) {
  const runs = snapshot ? allRuns(snapshot) : catalogSentimentRuns(evidence);
  const values = {complete: 0, running: 0, queued: 0, failed: 0, unknown: Math.max(0, 8 - runs.length)};
  runs.forEach(run => {
    if (isComplete(run)) values.complete++;
    else if (stateInfo(run).tone === 'running') values.running++;
    else if (stateInfo(run).tone === 'failed') values.failed++;
    else if (run.state === 'queued') values.queued++;
    else values.unknown++;
  });
  const colors = {complete: '#715ad5', running: '#ffcf59', queued: '#70bdf6', failed: '#ee8dbd', unknown: '#d4d7e0'};
  const names = {complete: 'Completed', running: 'Running', queued: 'Queued', failed: 'Needs attention', unknown: 'Awaiting data'};
  const circumference = 2 * Math.PI * 75;
  let offset = 0;
  return <section className="surface experiment-progress"><h2>Experiment progress</h2>
    <div className="ring-content"><svg viewBox="0 0 220 220" role="img"
      aria-label={Object.entries(values).map(([key, value]) => `${names[key]}: ${value}`).join(', ')}>
      <circle cx="110" cy="110" r="75" fill="none" stroke="#eeebf5" strokeWidth="31" />
      {Object.entries(values).filter(([, value]) => value > 0).map(([key, value]) => {
        const start = offset; offset += value / 8 * circumference;
        return <circle key={key} cx="110" cy="110" r="75" fill="none" stroke={colors[key]} strokeWidth="31"
          strokeDasharray={`${Math.max(0, value / 8 * circumference - 2)} ${circumference}`}
          strokeDashoffset={-start} transform="rotate(-90 110 110)" />;
      })}
      <text x="110" y="101" textAnchor="middle" className="ring-label">Total</text>
      <text x="110" y="137" textAnchor="middle" className="ring-total">8</text>
    </svg><ul className="ring-legend">{Object.entries(values).filter(([, value]) => value > 0).map(([key, value]) =>
      <li key={key}><span style={{backgroundColor: colors[key]}} /><span>{names[key]}: <strong>{value}</strong></span></li>)}</ul></div>
  </section>;
}

function DashboardChecklist({snapshot, evidence}) {
  const base = checklist(snapshot, evidence);
  const captions = snapshot?.caption_runs || [];
  const rows = [{title: 'Q1 results', state: base[0].status, note: base[0].status === 'complete' ? 'Complete' : 'Pending'},
    ...['baseline', 'alternate_encoder', 'simple_rnn'].map((id, index) => {
      const run = captions.find(item => item.id === id), state = stateInfo(run);
      return {title: `Q2${['a', 'b', 'c'][index]}: Train ${label(run || {id})}`, state: state.tone,
        note: state.tone === 'running' ? 'Training' : state.label};
    }),
    {title: 'Q2d: Model comparison', state: base[2].status, note: base[2].status === 'complete' ? 'Complete' : base[2].note === 'queued' ? 'Queued' : 'Review pending'},
    {title: 'Final files (report, code, results)', state: base[3].status, note: base[3].status === 'complete' ? 'Ready' : 'Pending review'},
  ];
  return <section className="surface dashboard-checklist"><h2>Assignment checklist</h2><ul>
    {rows.map(row => <li key={row.title}><span className={`check-square ${row.state}`}>{row.state === 'complete' && <Check size={14} aria-hidden="true" />}</span>
      <span className="check-title">{row.title}</span><span className={`check-pill ${row.state} ${row.note === 'Queued' ? 'queued' : ''} ${row.note === 'Pending review' ? 'review' : ''}`}>{row.note}</span></li>)}
  </ul></section>;
}

export default function Overview({snapshot, evidence, stale, onSelect, onNavigate}) {
  const reviewed = catalogSentimentRuns(evidence);
  const sentiment = reviewed.length ? reviewed : snapshot?.sentiment_runs || [];
  const runs = snapshot ? allRuns(snapshot) : reviewed;
  const completed = runs.filter(isComplete).length;
  const running = snapshot ? allRuns(snapshot).filter(run => stateInfo(run).tone === 'running').length : null;
  const passed = evidence?.verification?.tests_passed, total = evidence?.verification?.tests_total;
  const stats = [
    {title: 'Completed experiments', value: runs.length ? `${completed} / 8` : '— / 8', progress: runs.length ? completed / 8 : null, Icon: CircleCheck, color: 'purple'},
    {title: 'Training now', value: running === null ? '— models' : `${running} ${running === 1 ? 'model' : 'models'}`, progress: running === null ? null : running / 8, Icon: Play, color: 'blue'},
    {title: 'Verified model checks', value: `${number(passed)} / ${number(total)}`, progress: total > 0 ? passed / total : null, Icon: ShieldCheck, color: 'coral'},
  ];
  return <div className="overview-dashboard">
    <div className="overview-main">
      <div className="stat-cards">{stats.map(({title, value, progress, Icon, color}) => <section className={`surface stat-card ${color}`} key={title}>
        <span className="stat-icon"><Icon size={24} aria-hidden="true" /></span><p>{title}</p><strong>{value}</strong>
        <ProgressBar value={progress} label={title} /></section>)}</div>
      <section className="surface live-caption-card"><h2>{stale ? 'Image-captioning training' : 'Live image-captioning training'}</h2>
        <CaptionTable runs={snapshot?.caption_runs || []} onSelect={onSelect} compact />
        <p className="figure-note">Progress is provisional; final token-weighted loss and perplexity require a saved full epoch.</p>
      </section>
      <section className="surface completed-sentiment"><h2>Completed sentiment results</h2>
        <TableWrap label="Completed sentiment accuracies"><table><thead><tr><th>Model</th><th>Test accuracy</th></tr></thead>
          <tbody>{sentiment.filter(isComplete).map(run => <tr key={run.id}>
            <th scope="row"><button className="model-link" onClick={() => onSelect(run)}>{label(run)}</button></th><td>{percent(run.test_accuracy)}</td>
          </tr>)}</tbody></table></TableWrap>
        {!sentiment.length && <EmptyState>Reviewed sentiment results are loading.</EmptyState>}
        <button className="primary-button" onClick={() => onNavigate('results')}>View all results <ArrowRight size={20} aria-hidden="true" /></button>
      </section>
    </div>
    <div className="overview-aside"><ExperimentRing snapshot={snapshot} evidence={evidence} />
      <DashboardChecklist snapshot={snapshot} evidence={evidence} /><ActivityFeed snapshot={snapshot} /></div>
  </div>;
}
