// No public Worker route: this object is reached only through the Pages binding.
export class LiveSnapshot {
  constructor(ctx) { this.ctx = ctx; }
  async fetch(request) {
    if (request.method === 'GET') {
      const snapshot = await this.ctx.storage.get('latest');
      return Response.json(snapshot ?? {error: 'Waiting for the first verified snapshot'}, {status: snapshot ? 200 : 503});
    }
    if (request.method === 'POST') {
      const incoming = await request.json();
      return this.ctx.blockConcurrencyWhile(async () => {
        const previousRecord = await this.ctx.storage.get('latest');
        const previous = previousRecord?.snapshot ?? previousRecord;
        if (previous && Date.parse(incoming.snapshot_utc) < Date.parse(previous.snapshot_utc)) {
          return Response.json({error: 'An older snapshot cannot replace newer evidence'}, {status: 409});
        }
        await this.ctx.storage.put('latest', {snapshot:incoming, received_at:Date.now()});
        return Response.json({ok: true, snapshot_utc: incoming.snapshot_utc});
      });
    }
    return new Response('Method not allowed', {status: 405});
  }
}
export default { fetch() { return new Response('Not found', {status: 404}); } };
