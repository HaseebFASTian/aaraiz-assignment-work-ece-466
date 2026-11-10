import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogSentimentRuns, checklist, lastSync, progressRatio, snapshotIsStale, safeUrl, stateInfo} from '../src/lib/data.js';

const time = Date.parse('2026-11-10T12:00:00Z');
const fresh = {snapshot_utc: '2026-11-10T11:59:30Z', connected: true, stale: false,
  freshness: {stale_after_seconds: 120}, sentiment_runs: [], caption_runs: [], predictions: []};

test('persisted200 snapshots become stale independently of their stored flag', () => {
  assert.equal(snapshotIsStale(fresh, time), false);
  assert.equal(snapshotIsStale(fresh, time + 120000), true);
  assert.equal(snapshotIsStale({...fresh, connected: false}, time), true);
  assert.equal(snapshotIsStale({...fresh, snapshot_utc: 'invalid'}, time), true);
  assert.equal(snapshotIsStale({...fresh, snapshot_utc: '2026-11-10T12:02:01Z'}, time), true);
  assert.equal(snapshotIsStale(null, time), true);
});

test('source clock skew cannot conceal an expired monitor receipt', () => {
  const shifted = {...fresh, snapshot_utc: '2026-11-10T12:01:40Z',
    freshness: {stale_after_seconds: 120, monitor_checked_utc: '2026-11-10T12:00:00Z'}};
  assert.equal(snapshotIsStale(shifted, time), false);
  assert.equal(snapshotIsStale({...shifted, freshness: {...shifted.freshness,
    monitor_checked_utc: '2026-11-10T11:57:59Z'}}, time), true);
  assert.equal(lastSync(shifted), '2026-11-10T12:00:00Z');
  assert.equal(lastSync(fresh), fresh.snapshot_utc);
});

test('served freshness uses server age plus monotonic elapsed, not the client wall clock', () => {
  const served = {...fresh, freshness: {stale_after_seconds: 120, age_seconds: 10,
    served_utc: '2026-11-10T12:00:00Z', server_received_utc: '2026-11-10T11:59:50Z'}};
  assert.equal(snapshotIsStale(served, time + 86400000, 15), false);
  assert.equal(snapshotIsStale(served, time - 86400000, 15), false);
  assert.equal(snapshotIsStale(served, time - 86400000, 111), true);
  assert.equal(snapshotIsStale(served, time, null), true);
  assert.equal(snapshotIsStale({...served, freshness: {...served.freshness, age_seconds: null}}, time, 5), true);
  assert.equal(lastSync(served), '2026-11-10T11:59:50Z');
});

test('caption checklist distinguishes pending, running, failure and verified completion', () => {
  assert.equal(checklist(fresh, {})[1].status, 'pending');
  assert.equal(checklist({...fresh, caption_runs: [{state: 'running'}]}, {})[1].status, 'running');
  assert.equal(checklist({...fresh, failure: true, caption_runs: [{state: 'running'}]}, {})[1].status, 'failed');
  assert.equal(checklist({...fresh, caption_runs: [{state: 'failed'}]}, {})[1].status, 'failed');
  assert.equal(checklist({...fresh, caption_runs: Array.from({length: 3}, () => ({completed: true}))}, {})[1].status, 'complete');
});

test('comparison completion binds four images and twelve string outputs to the reviewed hashes', () => {
  const predictions_sha256 = 'a'.repeat(64), observations_sha256 = 'b'.repeat(64);
  const evidence = {readiness: {ready: false}, captioning: {generated_captions_verified: 12,
    comparison_review: {status: 'reviewed', predictions_sha256, observations_sha256}}};
  const snapshot = {...fresh,
    caption_runs: ['baseline', 'alternate_encoder', 'simple_rnn'].map(id => ({id, completed: true})),
    predictions: [49919, 116033, 273741, 177118].map((image_id, index) => {
      const image_sha256 = String(index + 1).repeat(64);
      return {image_id, image_sha256, predictions_sha256, observations_sha256,
        image_url: `/comparison-images/${String(image_id).padStart(12, '0')}.${image_sha256}.jpg`,
        observation: 'Synthetic reviewed fixture.', captions: {
          baseline: '', alternate_encoder: 'Recorded caption.', simple_rnn: 'Recorded caption.',
        }};
    })};
  assert.equal(checklist(snapshot, {})[2].status, 'pending');
  assert.equal(checklist(snapshot, evidence)[2].status, 'complete');
  assert.equal(checklist({...snapshot, caption_runs: snapshot.caption_runs.slice(1)}, evidence)[2].status, 'pending');
  for (const mutate of [
    row => ({...row, image_id: 49919}),
    row => ({...row, predictions_sha256: 'c'.repeat(64)}),
    row => ({...row, observations_sha256: 'c'.repeat(64)}),
    row => ({...row, image_url: `https://example.com${row.image_url}`}),
    row => ({...row, captions: {...row.captions, simple_rnn: null}}),
  ]) {
    assert.equal(checklist({...snapshot, predictions: snapshot.predictions.map(mutate)}, evidence)[2].status, 'pending');
  }
});

test('reviewed sentiment percentages convert once and preserve measured totals', () => {
  const [run] = catalogSentimentRuns({data_protocols: {sentiment: {epochs: 20, hidden_dim: 128}}, sentiment: {runs: [{
    id: 'lstm_uni', status: 'complete', epochs: 20, examples: 5000, correct: 3985,
    accuracy_percent: 79.70, test_cross_entropy: 0.52, parameters: 1000, embedding_dim: 10,
    history: [{epoch: 1, loss: 0.67, accuracy_percent: 61.25}],
  }]}});
  assert.equal(run.completed, true);
  assert.equal(run.test_accuracy, 0.797);
  assert.equal(run.test_correct, 3985);
  assert.equal(run.history[0].accuracy, 0.6125);
  assert.equal(run.test_examples - run.test_correct, 1015);
  assert.equal(run.config.hidden_size, 128);
});

test('ready file flags alone cannot bypass final submission review', () => {
  const outputs = [{id: 'word', status: 'ready'}, {id: 'pdf', status: 'ready'}];
  assert.equal(checklist(fresh, {final_outputs: outputs})[3].status, 'pending');
  assert.equal(checklist(fresh, {final_outputs: outputs, readiness: {ready: true}})[3].status, 'complete');
});

test('progress uses actual completed batches and cannot infer final completion', () => {
  assert.equal(progressRatio({progress: {completed_batches: 20, total_batches: 100}}), .2);
  assert.equal(progressRatio({progress: {completed_batches: null, total_batches: 100}}), null);
  assert.equal(stateInfo({state: 'saving', completed: false}).label, 'Finalizing');
  assert.equal(stateInfo({state: 'complete', completed: false}).tone, 'pending');
  assert.equal(progressRatio({completed: true}), 1);
});

test('links reject private paths, javascript and protocol-relative destinations', () => {
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('//example.com/file'), null);
  assert.equal(safeUrl('D:/private/file.pdf'), null);
  assert.equal(safeUrl('/../private'), null);
  assert.equal(safeUrl('/downloads/assignment.pdf'), '/downloads/assignment.pdf');
  assert.equal(safeUrl('https://cocodataset.org/'), 'https://cocodataset.org/');
});
