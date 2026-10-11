import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { feature } from './helpers.mjs';
import { makeService } from './helpers.mjs';

// Enable in CI or any environment that permits binding a loopback socket.
const socketTest = (name, fn) => test(name, { skip: process.env.LEGAL_SOCKET_TESTS !== '1' ? 'Loopback integration requires LEGAL_SOCKET_TESTS=1; Web handler contracts run locally.' : false }, fn);

async function start(t, options = {}) {
  const { service } = await makeService(t);
  const create = await feature('server', 'createHttpServer');
  const server = create(service, options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { base: `http://127.0.0.1:${server.address().port}`, server };
}
socketTest('HTTP serves the accessible chat page, assets and coverage status', async t => {
  const { base } = await start(t);
  const response = await fetch(base + '/');
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Irish law|Irish Law/);
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await fetch(base + '/app.mjs')).status, 200);
  assert.equal((await (await fetch(base + '/api/status')).json()).document_count, 4);
});
socketTest('HTTP chat returns versioned citations through the actual request path', async t => {
  const { base } = await start(t);
  const response = await fetch(base + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'annual leave', mode: 'lawyer' }) });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.ok(result.citations.some(c => c.section === '19'));
  assert.equal(result.current_law_verified, false);
});
socketTest('Streamable HTTP MCP supports initialization, calls and notification acknowledgements', async t => {
  const { base } = await start(t);
  const request = async body => fetch(base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify(body) });
  const initialized = await request({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
  assert.equal(initialized.status, 200);
  assert.equal((await initialized.json()).result.protocolVersion, '2025-06-18');
  assert.equal((await request({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
  assert.equal((await fetch(base + '/mcp', { headers: { accept: 'text/event-stream' } })).status, 405);
});
socketTest('HTTP rejects foreign origins, invalid bodies and unsupported media types', async t => {
  const { base } = await start(t);
  const foreign = await fetch(base + '/api/chat', { method: 'POST', headers: { origin: 'https://evil.test', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(foreign.status, 403);
  const malformed = await fetch(base + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  const text = await fetch(base + '/mcp', { method: 'POST', body: 'anything' });
  assert.equal(text.status, 415);
});
socketTest('HTTP enforces byte limits and a bounded per-client rate limit', async t => {
  const { base } = await start(t, { maxBodyBytes: 100, requestsPerMinute: 2 });
  const response = await fetch(base + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'a'.repeat(200) }) });
  assert.equal(response.status, 413);
  const send = () => fetch(base + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'annual leave' }) });
  await send();
  await send();
  assert.equal((await send()).status, 429);
});
socketTest('configured bearer protection rejects unauthorized chat and MCP requests', async t => {
  const { base } = await start(t, { bearerToken: 'test-token' });
  const request = token => fetch(base + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: '{"question":"annual leave"}' });
  assert.equal((await request()).status, 401);
  assert.equal((await request('test-token')).status, 200);
});
