export const NAVIGATION = [
  ['overview', 'Overview'], ['requirements', 'Requirements'], ['models', 'Models'], ['results', 'Results'],
  ['validation', 'Validation'], ['activity', 'Activity'], ['files', 'Files'],
];

export const MODEL_NAMES = {
  rnn_uni: 'RNN', rnn_bi: 'BiRNN', lstm_uni: 'LSTM', lstm_bi: 'BiLSTM',
  lstm_bi_embedding100: 'BiLSTM · embedding 100', baseline: 'ResNet-50 + LSTM',
  alternate_encoder: 'GoogLeNet + LSTM', simple_rnn: 'ResNet-50 + RNN',
};

export const number = (value, digits = 0) => Number.isFinite(value)
  ? value.toLocaleString('en-US', {minimumFractionDigits: digits, maximumFractionDigits: digits}) : '—';
export const percent = (value, digits = 2) => Number.isFinite(value) ? `${number(value * 100, digits)}%` : '—';
export const label = (run) => MODEL_NAMES[run?.id] || run?.label || 'Model';
export const isComplete = (run) => run?.completed === true;
export function progressRatio(run) {
  if (isComplete(run)) return 1;
  const p = run?.progress;
  return p?.total_batches > 0 && Number.isFinite(p.completed_batches)
    ? Math.max(0, Math.min(1, p.completed_batches / p.total_batches)) : null;
}
export function stateInfo(run) {
  if (isComplete(run)) return {label: 'Complete', tone: 'complete'};
  const value = String(run?.state || '').toLowerCase();
  if (/fail|error|cancel|timeout/.test(value)) return {label: 'Needs attention', tone: 'failed'};
  if (/partial|running|train/.test(value)) return {label: 'Running', tone: 'running'};
  if (/epoch_complete|finaliz|saving/.test(value)) return {label: 'Finalizing', tone: 'running'};
  if (/queue|pend/.test(value)) return {label: 'Queued', tone: 'pending'};
  if (/prepar|initial/.test(value)) return {label: 'Preparing', tone: 'pending'};
  return {label: value ? 'Awaiting update' : 'Unavailable', tone: 'pending'};
}
export function utcTime(value) {
  const parsed = new Date(value || '');
  return Number.isFinite(parsed.getTime())
    ? `${parsed.toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit', timeZone: 'UTC'})} UTC` : '—';
}
export function duration(value) {
  if (!Number.isFinite(value)) return '—';
  const minutes = Math.floor(value / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}
export function allRuns(snapshot) {
  return [...(snapshot?.sentiment_runs || []), ...(snapshot?.caption_runs || [])];
}
export function safeUrl(value) {
  if (typeof value !== 'string') return null;
  if (/^https:\/\//i.test(value)) return value;
  if (/^\/(?!\/)[a-zA-Z0-9_./% -]+$/.test(value) && !value.includes('..')) return value;
  return null;
}
export function snapshotIsStale(snapshot, now = Date.now(), elapsedSinceFetchSeconds = null) {
  if (!snapshot || snapshot.connected !== true || snapshot.stale === true) return true;
  const thresholdSeconds = Number.isFinite(snapshot.freshness?.stale_after_seconds)
    ? snapshot.freshness.stale_after_seconds : 120;
  if (Number.isFinite(Date.parse(snapshot.freshness?.served_utc))) {
    const suppliedAge = snapshot.freshness.age_seconds;
    if (!Number.isFinite(suppliedAge) || suppliedAge < 0 || !Number.isFinite(elapsedSinceFetchSeconds)) return true;
    return suppliedAge + Math.max(0, elapsedSinceFetchSeconds) > thresholdSeconds;
  }
  const timestamp = Date.parse(snapshot.snapshot_utc);
  if (!Number.isFinite(timestamp)) return true;
  const threshold = thresholdSeconds * 1000;
  const checked = Date.parse(snapshot.freshness?.monitor_checked_utc);
  const age = Math.max(0, now - timestamp, Number.isFinite(checked) ? now - checked : 0);
  return age > threshold || timestamp > now + 120000;
}
export const lastSync = snapshot => Number.isFinite(Date.parse(snapshot?.freshness?.server_received_utc))
  ? snapshot.freshness.server_received_utc : Number.isFinite(Date.parse(snapshot?.freshness?.monitor_checked_utc))
    ? snapshot.freshness.monitor_checked_utc : snapshot?.snapshot_utc;
export function checklist(snapshot, evidence) {
  const sentiment = snapshot?.sentiment_runs || [];
  const captions = snapshot?.caption_runs || [];
  const predictions = snapshot?.predictions || [];
  const sentimentDone = sentiment.length === 5 && sentiment.every(isComplete);
  const captionDone = captions.length === 3 && captions.every(isComplete);
  const captionFailed = snapshot?.failure === true || captions.some(run => stateInfo(run).tone === 'failed');
  const captionRunning = captions.some(run => stateInfo(run).tone === 'running');
  const captionState = captionDone ? 'complete' : captionFailed ? 'failed' : captionRunning ? 'running' : 'pending';
  const predictionReviewed = reviewedCaptionRows(snapshot, evidence).length === 4;
  const outputs = evidence?.final_outputs || [];
  const finalDone = evidence?.readiness?.ready === true && Array.isArray(outputs) && outputs.length > 0
    && outputs.every(row => row.status === 'ready');
  return [
    {title: 'Q1 · Sentiment results', status: sentimentDone ? 'complete' : 'pending', note: sentimentDone ? 'complete' : sentiment.length ? 'in progress' : 'awaiting data'},
    {title: 'Q2a–c · Caption models', status: captionState, note: captionDone ? 'complete' : captionFailed ? 'needs attention' : captionRunning ? 'running' : 'awaiting results'},
    {title: 'Q2d · Four-image comparison', status: predictionReviewed ? 'complete' : 'pending', note: predictionReviewed ? 'complete' : predictions.length ? 'pending review' : 'queued'},
    {title: 'Reports & code', status: finalDone ? 'complete' : 'pending', note: finalDone ? 'ready' : 'pending review'},
  ];
}

export function catalogSentimentRuns(evidence) {
  const protocol = evidence?.data_protocols?.sentiment || {};
  return (evidence?.sentiment?.runs || []).map(run => ({
    id: run.id, label: run.label, state: run.status,
    completed: run.status === 'complete' && run.epochs === 20 && run.examples === 5000,
    completed_epochs: run.epochs, total_epochs: protocol.epochs || 20,
    test_accuracy: Number.isFinite(run.accuracy_percent) ? run.accuracy_percent / 100 : null,
    test_examples: run.examples, test_correct: run.correct, test_cross_entropy: run.test_cross_entropy,
    parameters: run.parameters, embedding_dim: run.embedding_dim,
    config: {embedding_dim: run.embedding_dim, hidden_size: protocol.hidden_dim,
      num_layers: protocol.num_layers, dropout: protocol.dropout, batch_size: protocol.batch_size,
      precision: protocol.precision, bidirectional: run.bidirectional},
    history: (run.history || []).map(row => ({epoch: row.epoch, loss: row.loss,
      accuracy: Number.isFinite(row.accuracy_percent) ? row.accuracy_percent / 100 : null})),
  }));
}

export function reviewedCaptionRows(snapshot, evidence) {
  const rows = snapshot?.predictions || [];
  const review = evidence?.captioning?.comparison_review;
  const requiredModels = ['baseline', 'alternate_encoder', 'simple_rnn'];
  const expectedIds = [49919, 116033, 273741, 177118];
  const completedModels = snapshot?.caption_runs || [];
  if (!review || review.status !== 'reviewed' || evidence?.captioning?.generated_captions_verified !== 12
    || rows.length !== 4 || new Set(rows.map(row => row.image_id)).size !== 4
    || !requiredModels.every(id => completedModels.some(run => run.id === id && isComplete(run)))) return [];
  const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (!sha(review.predictions_sha256) || !sha(review.observations_sha256)) return [];
  const valid = rows.every(row => expectedIds.includes(row.image_id) && sha(row.image_sha256)
    && row.predictions_sha256 === review.predictions_sha256
    && row.observations_sha256 === review.observations_sha256
    && row.image_url === `/comparison-images/${String(row.image_id).padStart(12, '0')}.${row.image_sha256}.jpg`
    && typeof row.observation === 'string'
    && requiredModels.every(id => typeof row.captions?.[id] === 'string'));
  return valid ? expectedIds.map(id => rows.find(row => row.image_id === id)) : [];
}
