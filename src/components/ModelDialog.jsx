import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { HistoryChart } from './Charts.jsx';
import { StateBadge } from './Primitives.jsx';
import { duration, isComplete, label, number, percent } from '../lib/data.js';

export default function ModelDialog({run, onClose}) {
  const dialog = useRef(null);
  const [metric, setMetric] = useState('loss');
  const caption = ['baseline', 'alternate_encoder', 'simple_rnn'].includes(run.id);
  const config = run.config || {};
  const history = run.history || [];
  useEffect(() => {
    const element = dialog.current;
    if (!element.open) element.showModal();
    return () => element.close();
  }, []);
  const settings = [
    ['Task', caption ? 'Image captioning' : 'Sentiment analysis'],
    ['Completed epochs', number(run.completed_epochs)],
    ['Hidden dimension', number(config.hidden_size ?? (caption ? 512 : 164))],
    ['Embedding dimension', number(config.embed_size ?? config.embedding_dim ?? (caption ? 512 : run.id.endsWith('100') ? 100 : 10))],
    ['Batch size', number(config.batch_size ?? (caption ? 256 : 64))],
    ['Optimizer', 'Adam'], ['Learning rate', caption ? '0.001' : '0.0001'],
    ['Device', 'CPU'], ['Precision', config.precision || 'float32'],
  ];
  if (caption) settings.push(['CNN/image layout', config.channels_last === true ? 'Channels last' : config.channels_last === false ? 'Contiguous' : 'Not yet recorded'],
    ['CNN gradients', 'Frozen'], ['CNN statistics during training', 'Training mode']);
  if (!caption && isComplete(run)) {
    if (Number.isFinite(run.test_correct)) settings.push(['Correct test reviews', number(run.test_correct)],
      ['Incorrect test reviews', number(run.test_examples - run.test_correct)]);
    if (Number.isFinite(run.test_cross_entropy)) settings.push(['Test cross-entropy', number(run.test_cross_entropy, 6)]);
    if (Number.isFinite(run.parameters)) settings.push(['Model parameters', number(run.parameters)]);
  }
  return <dialog ref={dialog} className="model-dialog"
    onClose={event => {if (!event.currentTarget.open) onClose();}}
    onClick={event => {if (event.target === event.currentTarget) dialog.current.close();}}
    aria-labelledby="model-detail-title">
    <div className="dialog-content">
      <div className="dialog-header"><div><h2 id="model-detail-title">{label(run)}</h2><StateBadge run={run} /></div>
        <button className="icon-button" onClick={() => dialog.current.close()} aria-label="Close model details"><X size={23} /></button></div>
      {!caption && <div className="detail-result"><span>Held-out test accuracy</span><strong>{isComplete(run) ? percent(run.test_accuracy) : 'Pending'}</strong>
        <small>{number(run.test_examples)} test reviews</small></div>}
      {caption && <div className="detail-result"><span>{isComplete(run) ? 'Full-epoch training loss' : 'Provisional online loss'}</span>
        <strong>{number(isComplete(run) ? history.at(-1)?.loss : run.progress?.loss, 4)}</strong>
        <small>{number(run.progress?.seen_captions ?? history.at(-1)?.captions)} caption annotations processed</small></div>}
      <div className="chart-toolbar"><h3>Recorded training history</h3>
        <label className="select-label">Metric<select value={metric} onChange={event => setMetric(event.target.value)}>
          <option value="loss">Training loss</option>
          {history.some(item => Number.isFinite(item.accuracy)) && <option value="accuracy">Training accuracy</option>}
          {history.some(item => Number.isFinite(item.perplexity)) && <option value="perplexity">Perplexity</option>}
        </select></label></div>
      <HistoryChart history={history} metric={metric} title={metric === 'accuracy' ? 'Training accuracy' : metric === 'perplexity' ? 'Training perplexity' : 'Training loss'} />
      <dl className="settings-list">{settings.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
      {run.progress?.elapsed_seconds != null && <p className="muted">Recorded current-epoch elapsed time: {duration(run.progress.elapsed_seconds)}.</p>}
      {caption && <p className="figure-note">Loss is token weighted. A partial epoch is not a final model result.</p>}
    </div>
  </dialog>;
}
