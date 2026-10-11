import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { feature, temporary } from './helpers.mjs';
import { makeService } from './helpers.mjs';

test('stdio transport processes actual newline-delimited MCP requests without log pollution', async t => {
  const { service } = await makeService(t);
  const run = await feature('stdio', 'runStdio');
  const input = new PassThrough();
  const output = new PassThrough();
  let text = '';
  output.on('data', chunk => { text += chunk; });
  const done = run(service, input, output);
  input.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) + '\n' +
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n' +
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
  await done;
  const responses = text.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(responses.length, 2);
  assert.equal(responses[0].id, 1);
  assert.equal(responses[1].result.tools.length, 8);
});
test('stdio malformed and oversized messages return bounded protocol errors', async t => {
  const { service } = await makeService(t);
  const run = await feature('stdio', 'runStdio');
  const input = new PassThrough();
  const output = new PassThrough();
  let text = '';
  output.on('data', chunk => { text += chunk; });
  const done = run(service, input, output, { maxBytes: 100 });
  input.end('{\n' + 'a'.repeat(150) + '\n' + JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'ping' }) + '\n');
  await done;
  const responses = text.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(responses[0].error.code, -32700);
  assert.equal(responses[1].error.code, -32600);
  assert.deepEqual(responses[2].result, {});
});
test('CLI help and empty status work without a model or network credentials', async t => {
  const run = await feature('cli', 'runCli');
  const output = new PassThrough();
  let text = '';
  output.on('data', chunk => { text += chunk; });
  assert.equal(await run(['help'], { stdout: output, env: {} }), 0);
  assert.match(text, /sync|mcp|serve/);
  text = '';
  assert.equal(await run(['status','--store',await temporary(t)], { stdout: output, env: {} }), 0);
  assert.equal(JSON.parse(text).document_count, 0);
});
test('CLI rejects unknown commands and invalid port before starting a server', async () => {
  const run = await feature('cli', 'runCli');
  const errors = new PassThrough();
  let text = '';
  errors.on('data', chunk => { text += chunk; });
  assert.equal(await run(['destroy'], { stderr: errors, env: {} }), 2);
  assert.equal(await run(['serve','--port','invalid'], { stderr: errors, env: {} }), 2);
  assert.match(text, /command|port/i);
});
