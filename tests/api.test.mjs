import test from 'node:test';
import assert from 'node:assert/strict';
import {authorized, readBoundedJson} from '../lib/http.js';
import {LiveSnapshot} from '../cloudflare/store.js';
import {withCurrentFreshness} from '../lib/freshness.js';
import {onRequest as publishEndpoint} from '../functions/api/publish.js';
import {onRequest as statusEndpoint} from '../functions/api/status.js';

test('publisher authentication rejects missing, short and incorrect secrets', async () => {
  const expected = 'test-only-token-'.repeat(4);
  const request = value => new Request('https://example.test/api/publish', {headers: {Authorization: value}});
  assert.equal(await authorized(request(''), expected), false);
  assert.equal(await authorized(request('Bearer incorrect'), expected), false);
  assert.equal(await authorized(request('Bearer ' + expected), ''), false);
  assert.equal(await authorized(request('Bearer ' + expected), expected), true);
});
test('JSON reader bounds actual stream bytes and rejects a misleading length', async () => {
  const request = (body, headers = {}) => new Request('https://example.test', {method: 'POST', body, headers: {'Content-Type': 'application/json', ...headers}});
  assert.deepEqual(await readBoundedJson(request('{"value":1}'), 20), {value:1});
  await assert.rejects(readBoundedJson(request('{"long":"' + 'x'.repeat(100) + '"}', {'Content-Length': '1'}), 20));
  await assert.rejects(readBoundedJson(request('not-json'), 20));
});
test('latest snapshot survives reads and rejects out-of-order publication', async () => {
  const map = new Map();
  const object = new LiveSnapshot({storage: {get: async k => map.get(k), put: async (k,v) => map.set(k,v)}, blockConcurrencyWhile: fn => fn()});
  assert.equal((await object.fetch(new Request('https://internal/status'))).status, 503);
  const publish = snapshot => object.fetch(new Request('https://internal/status', {method:'POST',body:JSON.stringify(snapshot)}));
  assert.equal((await publish({snapshot_utc:'2026-11-10T07:00:00Z'})).status, 200);
  assert.equal((await publish({snapshot_utc:'2026-11-10T06:59:00Z'})).status, 409);
  const read = await (await object.fetch(new Request('https://internal/status'))).json();
  assert.equal(read.snapshot.snapshot_utc, '2026-11-10T07:00:00Z');
  assert.equal(typeof read.received_at, 'number');
});
test('edge receipt aging remains correct when workstation and server clocks differ', () => {
  const snapshot = {snapshot_utc:'2026-11-10T07:02:00Z',connected:true,stale:false,warnings:[],freshness:{age_seconds:15,stale_after_seconds:120,monitor_checked_utc:'2026-11-10T07:00:00Z'}};
  const received = Date.parse('2026-11-10T07:02:00Z');
  const fresh = withCurrentFreshness(snapshot, received + 10000, received);
  assert.equal(fresh.freshness.age_seconds,25);
  assert.equal(fresh.connected,true);
  const expired = withCurrentFreshness(snapshot, received + 110000, received);
  assert.equal(expired.stale,true);
  assert.equal(expired.connected,false);
});
test('successful reads cannot keep an expired or disconnected snapshot live', () => {
  const snapshot = {snapshot_utc: '2026-11-10T07:00:00Z', connected:true, stale:false, warnings:[], freshness:{stale_after_seconds:120}};
  assert.equal(withCurrentFreshness(snapshot, Date.parse('2026-11-10T07:01:00Z')).connected, true);
  const expired = withCurrentFreshness(snapshot, Date.parse('2026-11-10T07:03:00Z'));
  assert.equal(expired.connected, false);
  assert.equal(expired.stale, true);
  assert.equal(expired.freshness.age_seconds, 180);
  assert.equal(withCurrentFreshness({...snapshot, connected:false}, Date.parse('2026-11-10T07:01:00Z')).connected, false);
  assert.equal(withCurrentFreshness({...snapshot, snapshot_utc:null}).stale, true);
  const skewed = {...snapshot, snapshot_utc:'2026-11-10T07:04:00Z', freshness:{stale_after_seconds:120,monitor_checked_utc:'2026-11-10T07:00:00Z'}};
  assert.equal(withCurrentFreshness(skewed, Date.parse('2026-11-10T07:03:00Z')).stale, true);
});
test('public API is read-only without publisher credentials and rejects wrong methods', async () => {
  const env = {PUBLISH_TOKEN:'only-for-test-'.repeat(4)};
  const rejected = await publishEndpoint({env,request:new Request('https://example.test/api/publish',{method:'POST',body:'{"private":"not allowed"}'})});
  assert.equal(rejected.status,401);
  assert.equal((await publishEndpoint({env,request:new Request('https://example.test/api/publish')})).status,405);
  assert.equal((await statusEndpoint({env,request:new Request('https://example.test/api/status',{method:'POST'})})).status,405);
});
test('authenticated malformed or unapproved JSON never reaches the data store', async () => {
  let reached = false;
  const env = {PUBLISH_TOKEN:'only-for-test-'.repeat(4),LIVE:{get(){reached=true;throw new Error('should not reach')}}};
  const response = await publishEndpoint({env,request:new Request('https://example.test/api/publish',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+env.PUBLISH_TOKEN},body:JSON.stringify({server:'private host',password:'do-not-publish'})})});
  assert.equal(response.status,422);
  assert.equal(reached,false);
});
