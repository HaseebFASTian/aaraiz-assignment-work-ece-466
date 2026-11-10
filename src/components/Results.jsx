import { useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { HistoryChart } from './Charts.jsx';
import { CaptionTable } from './Overview.jsx';
import { EmptyState, SectionHeading, StateBadge, TableWrap } from './Primitives.jsx';
import { catalogSentimentRuns, isComplete, label, number, percent, reviewedCaptionRows, stateInfo } from '../lib/data.js';

const VARIANTS = ['baseline', 'alternate_encoder', 'simple_rnn'];
const PAIR_LABELS = {lstm_vs_rnn_uni: 'LSTM vs RNN · unidirectional', lstm_vs_rnn_bi: 'LSTM vs RNN · bidirectional',
  rnn_direction: 'BiRNN vs RNN', lstm_direction: 'BiLSTM vs LSTM', embedding_bonus: 'Embedding 100 vs 10 · BiLSTM'};

function CaptionResultSummary({snapshot}) {
  const runs = snapshot?.caption_runs || [];
  const done = runs.filter(isComplete).length;
  return <section className="surface caption-result-summary"><div className="inline-heading"><h2>Captioning results</h2>
    <p>{done} of 3 models complete · {done === 3 ? 'saved full-epoch metrics available' : 'remaining full-epoch metrics pending'}</p></div>
    <div className="caption-result-tiles">{VARIANTS.map((id, index) => {
      const run = runs.find(item => item.id === id);
      const state = stateInfo(run);
      return <div className={`caption-result-tile tone-${index}`} key={id}><span className="tile-icon"><ImageIcon size={23} aria-hidden="true" /></span>
        <strong>{label(run || {id})}</strong><span className={`check-pill ${state.tone}`}>{isComplete(run) ? 'Complete' : state.tone === 'failed' ? state.label : state.tone === 'running' ? 'Training' : 'Pending'}</span></div>;
    })}</div>
  </section>;
}

function CaptionComparison({snapshot, evidence}) {
  const rows = reviewedCaptionRows(snapshot, evidence);
  return <section className="surface caption-comparison"><SectionHeading title="Four-image caption comparison"
    note="The same four test images, evaluated by all three completed models." />
    {!rows.length ? <EmptyState>Twelve saved captions and their image-grounded review are pending. They will appear here when the recorded results and review hashes agree.</EmptyState>
      : <div className="comparison-images">{rows.map(row => <article key={row.image_id} className="comparison-image-row">
        <figure><img src={row.image_url} alt={`COCO test2017 image ${row.image_id}`} loading="lazy" /><figcaption>Image {row.image_id}</figcaption></figure>
        <div className="image-captions">{VARIANTS.map(id => <div key={id}><h3>{label({id})}</h3>
          <p>{row.captions[id] === '' ? <em>No words generated</em> : row.captions[id]}</p></div>)}
          <p className="review-observation"><strong>Reviewed observation:</strong> {row.observation}</p></div>
      </article>)}<a className="image-credits" href="/comparison-images/ATTRIBUTION.md">Image source and license credits</a></div>}
  </section>;
}

export default function Results({snapshot, evidence, onSelect}) {
  const [tab, setTab] = useState('sentiment');
  const [selected, setSelected] = useState('lstm_uni');
  const [metric, setMetric] = useState('loss');
  const catalog = catalogSentimentRuns(evidence);
  const sentiment = catalog.length ? catalog : snapshot?.sentiment_runs || [];
  const captions = snapshot?.caption_runs || [];
  const chartRun = sentiment.find(run => run.id === selected) || sentiment[0];
  const comparisons = evidence?.sentiment?.comparisons || [];
  const captionComparisons = evidence?.captioning?.metric_comparisons || [];
  const best = Math.max(...sentiment.filter(isComplete).map(run => run.test_accuracy));
  return <section className="page-section results-page">
    <SectionHeading title="Results" note="Completed evaluations, with the same data and training budget." />
    <div className="section-tabs" role="group" aria-label="Results task">
      <button aria-pressed={tab === 'sentiment'} onClick={() => setTab('sentiment')}>Sentiment analysis</button>
      <button aria-pressed={tab === 'captioning'} onClick={() => setTab('captioning')}>Image captioning</button>
    </div>
    {tab === 'sentiment' ? <>
      <section className="surface sentiment-test-results"><div className="inline-heading"><h2>Sentiment test results</h2>
        <p>20 epochs · 5,000 held-out reviews · course 90/10 split</p></div>
        <p className="table-scroll-hint">Scroll horizontally for all results.</p>
        {!sentiment.length ? <EmptyState /> : <TableWrap label="Complete sentiment evaluation results"><table>
          <thead><tr><th>Model</th><th>Embedding</th><th>Epochs</th><th>Correct / 5,000</th><th>Accuracy</th><th>Test CE</th><th>Parameters</th></tr></thead>
          <tbody>{sentiment.map(run => <tr key={run.id}><th scope="row"><button className="model-link" onClick={() => onSelect(run)}>{label(run)}</button></th>
            <td>{number(run.embedding_dim ?? run.config?.embedding_dim)}</td><td>{number(run.completed_epochs)}</td>
            <td>{isComplete(run) ? number(run.test_correct) : '—'}</td><td><span className={`accuracy-pill ${run.test_accuracy === best ? 'best' : ''}`}>
              {isComplete(run) ? percent(run.test_accuracy) : 'Pending'}</span></td>
            <td className="numeric">{isComplete(run) ? number(run.test_cross_entropy, 4) : '—'}</td><td>{number(run.parameters)}</td></tr>)}</tbody>
        </table></TableWrap>}
      </section>
      <div className="results-analysis-grid"><section className="surface history-panel">
        <div className="history-heading"><h2>Recorded training history</h2><div className="history-controls">
          <select aria-label="Training-history model" value={chartRun?.id || ''} onChange={event => setSelected(event.target.value)} disabled={!sentiment.length}>
            {sentiment.map(run => <option key={run.id} value={run.id}>{label(run)}</option>)}</select>
          <div className="metric-switch" role="group" aria-label="Training-history metric"><button aria-pressed={metric === 'loss'} onClick={() => setMetric('loss')}>Loss</button>
            <button aria-pressed={metric === 'accuracy'} onClick={() => setMetric('accuracy')}>Accuracy</button></div></div></div>
        <HistoryChart history={chartRun?.history} metric={metric} title={metric === 'loss' ? 'Online training loss' : 'Online training accuracy'} />
      </section><section className="surface measured-comparisons"><h2>Measured comparisons</h2>
        {!comparisons.length ? <EmptyState>Reviewed comparisons are loading.</EmptyState> : <ul>{comparisons.map((row, index) =>
          <li key={row.id} className={`comparison-tone-${index % 3}`}><strong>{PAIR_LABELS[row.id] || row.title}</strong>
            <span><span className={`change-pill ${row.change_percentage_points < 0 ? 'negative' : ''}`}>
              {row.change_percentage_points > 0 ? '+' : ''}{number(row.change_percentage_points, 2)} percentage points</span>
              <small>{row.change_correct > 0 ? '+' : ''}{number(row.change_correct)} correct reviews</small></span></li>)}</ul>}
        <p className="figure-note">Single-seed course experiment; accuracy and test loss are separate measures. A gain in one does not imply a gain in both.</p>
      </section></div>
      <CaptionResultSummary snapshot={snapshot} />
    </> : <>
      <section className="surface final-caption-results"><SectionHeading title="Full-epoch captioning results"
        note="Token-weighted online training cross-entropy and perplexity, recorded after a complete epoch." />
        <p className="table-scroll-hint">Scroll horizontally for all results.</p>
        <TableWrap label="Saved full-epoch captioning results"><table><thead><tr><th>Model</th><th>Epochs</th><th>Captions</th><th>Training loss</th><th>Perplexity</th><th>Status</th></tr></thead>
          <tbody>{VARIANTS.map(id => {
            const run = captions.find(item => item.id === id), last = run?.history?.at(-1);
            const complete = isComplete(run) && last?.captions === 591753 && Number.isFinite(last.loss) && Number.isFinite(last.perplexity);
            return <tr key={id}><th scope="row">{run ? <button className="model-link" onClick={() => onSelect(run)}>{label(run)}</button> : label({id})}</th>
              <td>{complete ? number(run.completed_epochs) : '—'}</td><td>{complete ? number(last.captions) : '—'}</td>
              <td className="numeric">{complete ? number(last.loss, 6) : '—'}</td><td className="numeric">{complete ? number(last.perplexity, 6) : '—'}</td>
              <td><span className={`check-pill ${complete ? 'complete' : 'pending'}`}>{complete ? 'Complete' : 'Pending'}</span></td></tr>;
          })}</tbody></table></TableWrap>
      </section>
      <section className="surface caption-metric-comparisons"><SectionHeading title="Caption model comparisons"
        note="Change from ResNet-50 + LSTM, using verified full-epoch training metrics." />
        {!captionComparisons.length ? <EmptyState>Numeric comparisons require the completed baseline and a completed variant.</EmptyState>
          : <TableWrap label="Caption metric changes from the baseline"><table><thead><tr><th>Variant</th><th>Loss change (nats/token)</th><th>Perplexity change</th><th>Perplexity change (%)</th></tr></thead>
            <tbody>{captionComparisons.map(row => <tr key={row.id}><th scope="row">{label({id: row.left})}</th>
              <td className="numeric">{row.loss_change > 0 ? '+' : ''}{number(row.loss_change, 6)}</td>
              <td className="numeric">{row.perplexity_change > 0 ? '+' : ''}{number(row.perplexity_change, 3)}</td>
              <td className="numeric">{row.perplexity_percent_change > 0 ? '+' : ''}{number(row.perplexity_percent_change, 2)}%</td></tr>)}</tbody></table></TableWrap>}
        <p className="figure-note">Negative changes mean lower loss or perplexity. These are online training metrics, not held-out caption quality scores.</p>
      </section>
      {captions.some(run => !isComplete(run)) && <section className="surface live-caption-card"><h2>Current training progress</h2>
        <CaptionTable runs={captions} onSelect={onSelect} detailed /><p className="figure-note">Partial-epoch loss and perplexity are provisional; they are not final results.</p></section>}
      <CaptionComparison snapshot={snapshot} evidence={evidence} />
    </>}
  </section>;
}
