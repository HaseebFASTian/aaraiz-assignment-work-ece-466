import {json, secureHeaders} from '../../lib/http.js';
import {withCurrentFreshness} from '../../lib/freshness.js';
async function onRequestGet({env}) {
  try {
    const response = await env.LIVE.get(env.LIVE.idFromName('hw6')).fetch('https://internal/status');
    const data = await response.json();
    return json(response.ok ? withCurrentFreshness(data.snapshot ?? data, Date.now(), data.received_at) : data, response.status);
  } catch {
    return json({error: 'The live feed is temporarily unavailable'}, 503);
  }
}
export const onRequest = context => context.request.method === 'GET' ? onRequestGet(context) : json({error: 'Method not allowed'}, 405);
