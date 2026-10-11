import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feature } from './helpers.mjs';
import { makeService } from './helpers.mjs';

async function setup(t, options = {}) {
  const { service } = await makeService(t);
  const create = await feature('server', 'createWebHandler');
  const handler = create(service, options);
  return (path, options = {}) => handler(new Request(`http://127.0.0.1:4173${path}`, options), { clientAddress: 'test-client' });
}
const post = value => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
test('Web handler serves chat assets, security headers and indexed status', async t => {
  const request = await setup(t);
  const response = await request('/');
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Irish law|Irish Law/);
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await request('/app.mjs')).status, 200);
  assert.equal((await (await request('/api/status')).json()).document_count, 4);
});
test('Web handler chat and MCP calls return exact versioned evidence', async t => {
  const request = await setup(t);
  const chat = await (await request('/api/chat', post({ question: 'annual leave', mode: 'lawyer' }))).json();
  assert.ok(chat.citations.some(c => c.section === '19'));
  const initialized = await request('/mcp', post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }));
  assert.equal((await initialized.json()).result.protocolVersion, '2025-06-18');
  assert.equal((await request('/mcp', post({ jsonrpc: '2.0', method: 'notifications/initialized' }))).status, 202);
  assert.equal((await request('/mcp')).status, 405);
});
test('Web handler rejects foreign origins, invalid JSON and unsupported content types', async t => {
  const request = await setup(t);
  assert.equal((await request('/api/chat', { ...post({ question: 'annual leave' }), headers: { origin: 'https://evil.test', 'content-type': 'application/json' } })).status, 403);
  assert.equal((await request('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await request('/mcp', { method: 'POST', body: 'text' })).status, 415);
});
test('Web handler enforces byte size, rate limits and bearer authorization', async t => {
  const request = await setup(t, { maxBodyBytes: 100, requestsPerMinute: 2, bearerToken: 'test-token' });
  const valid = question => ({ ...post({ question }), headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' } });
  assert.equal((await request('/api/chat', post({ question: 'annual leave' }))).status, 401);
  assert.equal((await request('/api/chat', valid('a'.repeat(200)))).status, 413);
  assert.equal((await request('/api/chat', valid('annual leave'))).status, 200);
  assert.equal((await request('/api/chat', valid('annual leave'))).status, 200);
  assert.equal((await request('/api/chat', valid('annual leave'))).status, 429);
});
test('Web handler rejects unrecognized hosts and reports malformed chat arguments', async t => {
  const { service } = await makeService(t);
  const create = await feature('server', 'createWebHandler');
  const handle = create(service);
  assert.equal((await handle(new Request('http://evil.test/api/status'))).status, 403);
  const request = await setup(t);
  assert.equal((await request('/api/chat', post({ question: 'annual leave', ignored: 'unsafe' }))).status, 400);
});
test('status rejects non-GET methods before dispatching a JSON-RPC body', async t => {
  const request = await setup(t);
  for (const method of ['POST', 'PUT', 'DELETE', 'HEAD']) {
    const response = await request('/api/status', method === 'HEAD' ? { method } : {
      ...post({ jsonrpc: '2.0', id: 1, method: 'ping' }), method
    });
    assert.equal(response.status, 405, `${method} must not dispatch RPC on the status route`);
    assert.equal(response.headers.get('allow'), 'GET');
  }
  assert.equal((await request('/api/status')).status, 200);
});
