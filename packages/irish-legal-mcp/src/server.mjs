import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { handleRpc } from './protocol.mjs';
import { answerQuestion } from './chat.mjs';

const ASSETS = { '/': ['index.html','text/html; charset=utf-8'], '/app.mjs': ['app.mjs','text/javascript; charset=utf-8'], '/styles.css': ['styles.css','text/css; charset=utf-8'] };
const HEADERS = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" };

export function createWebHandler(service, { maxBodyBytes = 32 * 1024, requestsPerMinute = 30, bearerToken, allowedOrigins = [], generate } = {}) {
  const clients = new Map();
  const send = (status, body, type = 'application/json; charset=utf-8', extra = {}) => new Response(body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body),
    { status, headers: { ...HEADERS, 'content-type': type, ...extra } });
  return async (request, { clientAddress = 'local' } = {}) => {
    try {
      const url = new URL(request.url);
      const origin = request.headers.get('origin');
      if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname) && !allowedOrigins.includes(url.origin)) return send(403, { error: 'Host not allowed.' });
      if (origin && origin !== url.origin && !allowedOrigins.includes(origin)) return send(403, { error: 'Origin not allowed.' });
      if (request.method === 'GET' && ASSETS[url.pathname]) {
        const [file, type] = ASSETS[url.pathname];
        return send(200, await readFile(new URL(`../ui/${file}`, import.meta.url), 'utf8'), type);
      }
      if (!['/api/status','/api/chat','/mcp'].includes(url.pathname)) return send(404, { error: 'Not found.' });
      if (bearerToken) {
        const actual = Buffer.from(request.headers.get('authorization') ?? '');
        const expected = Buffer.from(`Bearer ${bearerToken}`);
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return send(401, { error: 'Authorization required.' }, undefined, { 'www-authenticate': 'Bearer' });
      }
      if (url.pathname === '/api/status' && request.method === 'GET') return send(200, (await service.call('irish_legal_catalogue', {})).coverage);
      if (request.method !== 'POST') return send(405, { error: 'Use POST; this stateless server does not provide a GET event stream.' }, undefined, { allow: 'POST' });
      if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return send(415, { error: 'Expected application/json.' });
      if (Number(request.headers.get('content-length') ?? 0) > maxBodyBytes) return send(413, { error: 'Request body too large.' });
      const chunks = [];
      let length = 0;
      if (request.body) {
        const reader = request.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > maxBodyBytes) { await reader.cancel(); return send(413, { error: 'Request body too large.' }); }
            chunks.push(Buffer.from(value));
          }
        } finally { reader.releaseLock(); }
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {
        return send(400, url.pathname === '/mcp'
          ? { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error.' } }
          : { error: 'Invalid JSON.' });
      }
      const minute = Math.floor(Date.now() / 60000);
      for (const [key, value] of clients) if (value.minute < minute) clients.delete(key);
      const previous = clients.get(clientAddress) ?? { minute, count: 0 };
      if (previous.count >= requestsPerMinute || (!clients.has(clientAddress) && clients.size >= 10000)) return send(429, { error: 'Rate limit exceeded.' }, undefined, { 'retry-after': '60' });
      clients.set(clientAddress, { minute, count: previous.count + 1 });
      if (url.pathname === '/api/chat') {
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['question','mode','as_of'].includes(key))) return send(400, { error: 'Invalid chat request.' });
        return send(200, await answerQuestion(service, body.question, { mode: body.mode, as_of: body.as_of, generate }));
      }
      const result = await handleRpc(service, body);
      return result === null ? send(202) : send(result.error?.code === -32600 ? 400 : 200, result);
    } catch (error) {
      if (/^BAD_ARGS:/.test(error.message)) return send(400, { error: error.message });
      return send(503, { error: 'Evidence service is temporarily unavailable.' });
    }
  };
}

export function createHttpServer(service, options = {}) {
  const handler = createWebHandler(service, options);
  return createServer(async (request, response) => {
    try {
      const method = request.method ?? 'GET';
      const webRequest = new Request(`http://${request.headers.host ?? 'localhost'}${request.url}`, {
        method, headers: Object.entries(request.headers).flatMap(([key, value]) => value === undefined ? [] : [[key, Array.isArray(value) ? value.join(', ') : value]]),
        ...(!['GET','HEAD'].includes(method) ? { body: Readable.toWeb(request), duplex: 'half' } : {})
      });
      const result = await handler(webRequest, { clientAddress: request.socket.remoteAddress ?? 'unknown' });
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(await result.text());
      if (!request.complete) request.resume();
    } catch {
      response.writeHead(503, { ...HEADERS, 'content-type': 'application/json' });
      response.end('{"error":"Evidence service is temporarily unavailable."}');
    }
  });
}
