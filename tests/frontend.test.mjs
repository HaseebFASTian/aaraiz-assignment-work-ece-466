import test from 'node:test';
import assert from 'node:assert/strict';
import {checklist, lastSync, progressRatio, snapshotIsStale, safeUrl, stateInfo} from '../src/lib/data.js';

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

test('comparison completion needs four distinct images, three string captions and review', () => {
  const snapshot = {...fresh, predictions: [{}, {}, {}, {}]};
  assert.equal(checklist(snapshot, {})[2].status, 'pending');
  assert.equal(checklist(snapshot, {readiness: {verified_captions: 12, final_visual_review_complete: false}})[2].status, 'pending');
  assert.equal(checklist(snapshot, {readiness: {verified_captions: 12, final_visual_review_complete: true}})[2].status, 'pending');
  const completePredictions = {...snapshot, predictions: Array.from({length: 4}, (_, image_id) => ({image_id, captions: {
    resnet50_lstm: '', googlenet_lstm: 'Recorded caption.', resnet50_rnn: 'Recorded caption.',
  }}))};
  assert.equal(checklist(completePredictions, {readiness: {verified_captions: 12, final_visual_review_complete: true}})[2].status, 'complete');
  const duplicateImages = {...completePredictions, predictions: completePredictions.predictions.map(row => ({...row, image_id: 1}))};
  assert.equal(checklist(duplicateImages, {readiness: {verified_captions: 12, final_visual_review_complete: true}})[2].status, 'pending');
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
