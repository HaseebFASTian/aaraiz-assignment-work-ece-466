import { useState } from 'react';
import { ArrowUpRight, Check, Download, FileText, ShieldCheck } from 'lucide-react';
import { AccuracyBars, HistoryChart } from './Charts.jsx';
import { ActivityFeed, CaptionTable, ModelConfiguration } from './Overview.jsx';
import { EmptyState, SectionHeading, StateBadge, StatusIcon, TableWrap } from './Primitives.jsx';
import { isComplete, label, lastSync, number, percent, safeUrl, utcTime } from '../lib/data.js';

export function Requirements({evidence}) {
  const requirements = Array.isArray(evidence?.requirements) ? evidence.requirements : [];
  const notes = Array.isArray(evidence?.methodological_notes) ? evidence.methodological_notes : [];
  return <section className="page-section">
    <SectionHeading title="Assignment requirements" note="The required work, its completion criteria and the evidence behind each result." />
    {!requirements.length ? <EmptyState>Reviewed assignment requirements are loading.</EmptyState> : <div className="requirement-list">
      {requirements.map(item => <article key={item.id} className="requirement-row">
        <span className="requirement-id">{item.id}</span><div><h3>{item.title}</h3><p>{item.description}</p>
          {item.criterion && <p className="criterion"><strong>Completion criterion:</strong> {item.criterion}</p>}</div>
        <span className={`requirement-status ${item.status === 'complete' || item.status === 'verified' ? 'complete' : 'pending'}`}>
          {String(item.status || 'pending').replaceAll('_', ' ')}</span>
      </article>)}</div>}
    {!!notes.length && <section className="method-notes"><h2>Protocol notes</h2>{notes.map((note, index) =>
      <article key={note.id || index}><h3>{note.title || `Note ${index + 1}`}</h3><p>{note.text || String(note)}</p></article>)}</section>}
  </section>;
}

export function Models({snapshot, onSelect}) {
  const [tab, setTab] = useState('sentiment');
  const [selected, setSelected] = useState('lstm_uni');
  const sentiment = snapshot?.sentiment_runs || [];
  const captions = snapshot?.caption_runs || [];
  const chartRun = sentiment.find(run => run.id === selected) || sentiment[0];
  return <section className="page-section">
    <SectionHeading title="Models & results" note="Completed evaluations and the current state of every training run." />
    <div className="section-tabs" role="group" aria-label="Experiment task">
      <button aria-pressed={tab === 'sentiment'} onClick={() => setTab('sentiment')}>Sentiment analysis</button>
      <button aria-pressed={tab === 'captioning'} onClick={() => setTab('captioning')}>Image captioning</button>
    </div>
    {tab === 'sentiment' ? <>
      <div className="results-split"><section><h3>Held-out test accuracy</h3><AccuracyBars runs={sentiment} onSelect={onSelect} />
        <p className="figure-note">5,000 held-out reviews · the same course split for all five configurations.</p></section>
        <section><div className="chart-toolbar"><h3>Training loss</h3><label className="select-label">Model
          <select value={chartRun?.id || ''} onChange={event => setSelected(event.target.value)} disabled={!sentiment.length}>
            {sentiment.map(run => <option key={run.id} value={run.id}>{label(run)}</option>)}</select></label></div>
          <HistoryChart history={chartRun?.history} title={`${label(chartRun)} training loss`} /></section></div>
      <TableWrap label="Sentiment evaluation results"><table>
        <thead><tr><th>Model</th><th>Epochs</th><th>Test examples</th><th className="align-right">Test accuracy</th><th>Status</th></tr></thead>
        <tbody>{sentiment.map(run => <tr key={run.id}><th scope="row"><button className="model-link" onClick={() => onSelect(run)}>{label(run)}</button></th>
          <td>{number(run.completed_epochs)} / {number(run.total_epochs)}</td><td>{number(run.test_examples)}</td>
          <td className="align-right numeric">{isComplete(run) ? percent(run.test_accuracy) : 'Pending'}</td><td><StateBadge run={run} /></td></tr>)}</tbody>
      </table></TableWrap>
    </> : <>
      <CaptionTable runs={captions} onSelect={onSelect} detailed />
      <p className="figure-note">Online loss and perplexity are provisional until a full epoch and its checkpoint are saved.</p>
      <section className="comparison-pending"><h3>Four-image caption comparison</h3>
        {snapshot?.predictions?.length === 4 ? <p>Four recorded image comparisons are available in the published evidence.</p>
          : <p>The same four test images will be evaluated with all three completed models. Twelve generated captions are required.</p>}
      </section>
    </>}
    <ModelConfiguration snapshot={snapshot} onSelect={onSelect} />
  </section>;
}

export function Validation({evidence}) {
  const verification = evidence?.verification || {};
  const groups = Array.isArray(verification.test_groups) ? verification.test_groups : [];
  const sources = Array.isArray(evidence?.sources) ? evidence.sources : [];
  const fingerprints = Array.isArray(verification.hashes) ? verification.hashes : [];
  const sentiment = evidence?.data_protocols?.sentiment;
  const caption = evidence?.data_protocols?.captioning;
  const benchmark = verification.benchmark;
  const sentimentSettings = sentiment ? [
    ['Dataset and split', `${sentiment.dataset}: ${number(sentiment.source_reviews)} reviews; ${number(sentiment.train_examples)} training / ${number(sentiment.test_examples)} held out. ${sentiment.split}`],
    ['Class balance', `Training: ${number(sentiment.train_label_counts?.negative)} negative / ${number(sentiment.train_label_counts?.positive)} positive. Test: ${number(sentiment.test_label_counts?.negative)} negative / ${number(sentiment.test_label_counts?.positive)} positive.`],
    ['Cleaning', sentiment.cleaning?.join('; ')],
    ['Tokenizer', `${sentiment.tokenizer}. Limit: ${number(sentiment.tokenizer_num_words)} tokens; OOV token: ${sentiment.oov_token}. Embedding rows: ${number(sentiment.embedding_rows)}.`],
    ['Sequence handling', `${number(sentiment.sequence_length)} tokens; ${sentiment.padding}-padding and ${sentiment.truncating}-truncation; ${sentiment.packing ? 'packed' : 'not packed'}.`],
    ['Recurrent model', `Hidden dimension ${number(sentiment.hidden_dim)}; ${number(sentiment.num_layers)} layer; dropout ${number(sentiment.dropout)}. Embeddings: ${sentiment.embedding_dimensions?.join(' / ')}.`],
    ['Training', `${number(sentiment.epochs)} epochs; batch ${number(sentiment.batch_size)}; ${sentiment.optimizer}, learning rate ${sentiment.learning_rate}.`],
    ['Objective', sentiment.loss],
    ['Seed and runtime', `Seed ${number(sentiment.seed)}; ${sentiment.device}, ${sentiment.precision}; PyTorch ${sentiment.training_torch_version}.`],
  ] : [];
  const captionSettings = caption ? [
    ['Dataset', `${caption.dataset}: ${number(caption.training_images)} training images and ${number(caption.training_caption_annotations)} caption annotations.`],
    ['Full epoch', `${number(caption.full_epoch_batches)} batches; ${caption.batch_sampler}. Every annotation is visited once.`],
    ['Vocabulary', `${number(caption.vocabulary_size)} tokens; ${caption.vocabulary_source}. Start/end/unknown IDs: ${caption.special_tokens?.['<start>']} / ${caption.special_tokens?.['<end>']} / ${caption.special_tokens?.['<unk>']}.`],
    ['Training images', caption.train_transform?.join('; ')],
    ['Test images', caption.test_transform?.join('; ')],
    ['Model dimensions', `Embedding ${number(caption.embedding_size)}; hidden ${number(caption.hidden_size)}; ${number(caption.num_layers)} recurrent layer; recurrent dropout ${number(caption.recurrent_dropout)}.`],
    ['Training', `${number(caption.planned_epochs)} full epoch; batch ${number(caption.batch_size)}; ${caption.optimizer}, learning rate ${caption.learning_rate}.`],
    ['Teacher forcing', caption.teacher_forcing],
    ['CNN behavior', `${caption.cnn_parameters_frozen ? 'CNN parameter gradients are frozen' : 'CNN parameters are trainable'}; BatchNorm/dropout ${caption.freeze_backbone_statistics ? 'remain in evaluation mode' : 'remain in training mode'}.`],
    ['Decoding and comparison', `${caption.decoding}. ${number(caption.selected_test_images)} identical test images for each completed model.`],
    ['Seed and runtime', `Seed ${number(caption.seed)}; ${caption.device}, ${caption.precision}; ${number(caption.cnn_threads)} threads and ${number(caption.data_loader_workers)} data-loader workers.`],
  ] : [];
  return <section className="page-section">
    <SectionHeading title="Validation & evidence" note="Implementation checks support the code; completed experiments support the reported results." />
    <div className="validation-summary"><ShieldCheck size={32} strokeWidth={1.6} aria-hidden="true" />
      <div><strong>{number(verification.tests_passed)} / {number(verification.tests_total)}</strong><span>implementation checks passed</span></div>
      <p>Synthetic tests are kept separate from measured training and test results.</p></div>
    {!!groups.length && <TableWrap label="Implementation test groups"><table><thead><tr><th>Check group</th><th>Scope</th><th>Status</th></tr></thead>
      <tbody>{groups.map((group, index) => <tr key={group.id || index}><th scope="row">{group.title || group.label || group.name}</th>
        <td>{group.description || group.scope || `${number(group.unique_count)} ${group.unique_count === 1 ? 'check' : 'checks'}`}</td>
        <td className="complete"><Check size={16} aria-hidden="true" /> {group.status || 'Passed'}</td></tr>)}</tbody></table></TableWrap>}
    {(sentiment || caption) && <details className="evidence-disclosure">
      <summary>Dataset & training protocols <span>IMDB · COCO 2017</span></summary>
      <div className="protocol-columns">{[['Sentiment analysis', sentimentSettings], ['Image captioning', captionSettings]].map(([title, rows]) =>
        <section key={title}><h3>{title}</h3><dl className="protocol-definitions">{rows.map(([name, value]) =>
          <div key={name}><dt>{name}</dt><dd>{value || 'Not recorded'}</dd></div>)}</dl></section>)}</div>
    </details>}
    {benchmark && <details className="evidence-disclosure">
      <summary>Recorded CPU memory-layout benchmark <span>{number(benchmark.mean_update_speedup, 3)}× measured speedup</span></summary>
      <div className="benchmark-detail">
        <p><strong>{number(benchmark.mean_nchw_seconds, 3)} s → {number(benchmark.mean_channels_last_seconds, 3)} s</strong> per update:
          contiguous versus channels-last storage, with the same FP32 model and input values.</p>
        <dl className="protocol-definitions benchmark-settings">
          <div><dt>Timing fixture</dt><dd>Batch {number(benchmark.batch_size)}, caption length {number(benchmark.sequence_length)},
            vocabulary {number(benchmark.vocabulary_size)}; {number(benchmark.warmup_updates)} warmup and {number(benchmark.timed_updates)} timed updates.</dd></div>
          <div><dt>Numerical check</dt><dd>{number(benchmark.initial_logits_compared)} initial logits compared;
            {' '}{number(benchmark.initial_logits_outside_tolerance)} outside absolute/relative tolerances {benchmark.absolute_tolerance} / {benchmark.relative_tolerance}.</dd></div>
          <div><dt>Maximum difference</dt><dd className="numeric">{Number.isFinite(benchmark.maximum_absolute_logit_difference)
            ? benchmark.maximum_absolute_logit_difference.toExponential(4) : '—'}</dd></div>
        </dl>
        <p className="method-note">Synthetic diagnostic, not an assignment training result. {benchmark.qualification}</p>
      </div>
    </details>}
    {!!fingerprints.length && <details className="evidence-disclosure">
      <summary>Verification fingerprints <span>{number(fingerprints.length)} SHA-256 records</span></summary>
      <dl className="fingerprint-list">{fingerprints.map(item => <div key={item.id}>
        <dt>{item.title}</dt><dd><code>{item.sha256}</code><p>{item.verification}</p></dd>
      </div>)}</dl>
    </details>}
    {evidence?.readiness && <section className="method-notes"><h2>Submission readiness</h2>
      <p>{evidence.readiness.ready ? 'All recorded submission gates are satisfied.' : 'The submission remains pending until every required result is verified.'}</p>
      <ul className="plain-checklist">{(evidence.readiness.pending_gates || []).map((item, index) => <li key={index}><StatusIcon state="pending" />
        <span>{typeof item === 'string' ? item : item.title || item.description}</span></li>)}</ul></section>}
    {!!sources.length && <section className="sources-section"><h2>Sources</h2><ul>{sources.map((source, index) => {
      const href = safeUrl(source.url);
      return <li key={source.id || index}>{href ? <a href={href} target="_blank" rel="noreferrer">{source.title || source.label || 'Source'}
        <ArrowUpRight size={15} aria-hidden="true" /></a> : <span>{source.title || source.label}</span>}
        {source.description && <p>{source.description}</p>}</li>;
    })}</ul></section>}
  </section>;
}

export function Activity({snapshot, stale}) {
  const events = snapshot?.batch_events || [];
  const warnings = snapshot?.warnings || [];
  return <section className="page-section">
    <SectionHeading title="Server activity" note="A sanitized feed of observed job states and completed work. Updates every 15 seconds." />
    <p className="feed-status-line">{stale ? 'Connection interrupted or snapshot stale.' : 'Latest received snapshot:'} <strong>{utcTime(lastSync(snapshot))}</strong></p>
    <ActivityFeed snapshot={snapshot} expanded />
    {!!warnings.length && <div className="notice" role="status">The monitor reports {warnings.length} warning{warnings.length === 1 ? '' : 's'}. Current readings may be incomplete.</div>}
    <section className="batch-events"><h2>Recorded batch updates</h2>
      {!events.length ? <EmptyState>Batch history will appear when the monitor has recorded an update.</EmptyState> : <TableWrap label="Recorded batch events"><table>
        <thead><tr><th>Model</th><th>Observed</th><th>Completed batches</th><th>Epoch</th><th>Metric</th><th>Loss</th></tr></thead>
        <tbody>{events.slice(-30).reverse().map((event, index) => <tr key={`${event.run_id}-${event.observed_at_utc}-${index}`}>
          <td>{label({id: event.run_id})}</td><td>{utcTime(event.observed_at_utc)}</td>
          <td className="numeric">{number(event.batch)} / {number(event.total_batches)}</td><td className="numeric">{number(event.epoch)}</td>
          <td>{event.kind === 'running_epoch_loss' ? 'Online epoch loss' : 'Batch loss'}</td>
          <td className="numeric">{number(event.loss, 4)}</td></tr>)}</tbody></table></TableWrap>}
    </section>
  </section>;
}

export function Deliverables({evidence}) {
  const outputs = Array.isArray(evidence?.final_outputs) ? evidence.final_outputs : [];
  return <section className="page-section">
    <SectionHeading title="Final deliverables" note="Submission files become available after the required experiments and final review are complete." />
    {!outputs.length ? <EmptyState>The final deliverable list is awaiting reviewed evidence.</EmptyState> : <div className="deliverable-list">
      {outputs.map(item => {
        const href = item.status === 'ready' ? safeUrl(item.url) : null;
        return <article className="deliverable-row" key={item.id}>
          <FileText size={28} strokeWidth={1.5} aria-hidden="true" /><div><h3>{item.label}</h3>
            <p>{item.description || (href ? 'Reviewed submission artifact.' : 'Pending completed results and final review.')}</p></div>
          {href ? <a className="outline-button" href={href} download><Download size={17} aria-hidden="true" /> Download</a>
            : <span className="pending-label">Pending review</span>}
        </article>;
      })}</div>}
    <p className="method-note">Working logs, provisional results and private server files are not submission artifacts.</p>
  </section>;
}
