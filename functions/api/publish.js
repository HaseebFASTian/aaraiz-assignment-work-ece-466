import {authorized, json, readBoundedJson} from '../../lib/http.js';
import {validateSnapshot} from '../../lib/validate-snapshot.js';
async function onRequestPost({request, env}) {
  if (!await authorized(request, env.PUBLISH_TOKEN)) return json({error: 'Unauthorized'}, 401);
  let snapshot;
  try { snapshot = await readBoundedJson(request); }
  catch { return json({error: 'Expected bounded JSON snapshot'}, 400); }
  if (!validateSnapshot(snapshot)) return json({error: 'Invalid public snapshot'}, 422);
  if (snapshot.snapshot_utc === null || !Number.isFinite(Date.parse(snapshot.snapshot_utc))) return json({error: 'Source timestamp required'}, 422);
  if (Date.parse(snapshot.snapshot_utc) > Date.now() + 120000) return json({error: 'Snapshot timestamp is in the future'}, 422);
  try {
    const response = await env.LIVE.get(env.LIVE.idFromName('hw6')).fetch(new Request('https://internal/status', {
      method: 'POST', body: JSON.stringify(snapshot), headers: {'Content-Type': 'application/json'},
    }));
    return json(await response.json(), response.status);
  } catch { return json({error: 'Publication temporarily unavailable'}, 503); }
}
export const onRequest = context => context.request.method === 'POST' ? onRequestPost(context) : json({error: 'Method not allowed'}, 405);
