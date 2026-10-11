import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feature } from './helpers.mjs';
import { makeService } from './helpers.mjs';
const rpc = (method, params = {}, id = 1) => ({ jsonrpc: '2.0', id, method, params });

test('MCP initialization negotiates protocol and advertises read-only tools and resources', async t => {
  const { service } = await makeService(t);
  const handle = await feature('protocol', 'handleRpc');
  const response = await handle(service, rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } }));
  assert.equal(response.result.protocolVersion, '2025-06-18');
  assert.ok(response.result.capabilities.tools);
  assert.ok(response.result.capabilities.resources);
  assert.equal(response.result.serverInfo.name, 'irish-legal-mcp');
});
test('MCP tool list exposes schemas and calling a tool returns structured cited content', async t => {
  const { service } = await makeService(t);
  const handle = await feature('protocol', 'handleRpc');
  const list = await handle(service, rpc('tools/list'));
  assert.equal(list.result.tools.length, 8);
  assert.ok(list.result.tools.every(tool => tool.annotations.readOnlyHint));
  const result = await handle(service, rpc('tools/call', { name: 'irish_legal_get_provision', arguments: { year: 1997, number: 20, section: '19', version_type: 'enacted' } }));
  assert.equal(result.result.structuredContent.section, '19');
  assert.match(result.result.content[0].text, /annual leave/);
});
test('MCP resources provide source attribution and actual indexed coverage', async t => {
  const { service } = await makeService(t);
  const handle = await feature('protocol', 'handleRpc');
  const list = await handle(service, rpc('resources/list'));
  assert.ok(list.result.resources.some(r => r.uri === 'ireland-legal://coverage'));
  const read = await handle(service, rpc('resources/read', { uri: 'ireland-legal://coverage' }));
  assert.equal(JSON.parse(read.result.contents[0].text).document_count, 4);
});
test('invalid JSON-RPC, missing tool args and unsupported methods produce protocol errors', async t => {
  const { service } = await makeService(t);
  const handle = await feature('protocol', 'handleRpc');
  assert.equal((await handle(service, { method: 'tools/list', id: 1 })).error.code, -32600);
  assert.equal((await handle(service, rpc('tools/call', { name: 'irish_legal_search', arguments: {} }))).error.code, -32602);
  assert.equal((await handle(service, rpc('write/delete_all'))).error.code, -32601);
  assert.equal(await handle(service, { jsonrpc: '2.0', method: 'notifications/initialized' }), null);
});
