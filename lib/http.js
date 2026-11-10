export const secureHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex',
};
export const json = (data, status = 200) => Response.json(data, {status, headers: secureHeaders});
export async function authorized(request, expected) {
  if (typeof expected !== 'string' || expected.length < 32) return false;
  const header = request.headers.get('Authorization') ?? '';
  if (!header.startsWith('Bearer ') || header.length > 256) return false;
  const bytes = new TextEncoder();
  const [a, b] = await Promise.all([header.slice(7), expected].map(value => crypto.subtle.digest('SHA-256', bytes.encode(value))));
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}
export async function readBoundedJson(request, maximum = 384 * 1024) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new Error('type');
  if (Number(request.headers.get('Content-Length')) > maximum) throw new Error('size');
  if (!request.body) throw new Error('body');
  const reader = request.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new Error('size'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const buffer = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(buffer));
}
