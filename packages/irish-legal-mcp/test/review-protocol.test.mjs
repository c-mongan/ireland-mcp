import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { runCli } from '../src/cli.mjs';
import { createWebHandler } from '../src/server.mjs';
import { makeService, temporary } from './helpers.mjs';

test('HTTP MCP malformed JSON returns a JSON-RPC parse error with a null id', async t => {
  const { service } = await makeService(t);
  const handle = createWebHandler(service);
  for (const body of ['{', '', '{"jsonrpc":"2.0","id":42,']) {
    const response = await handle(new Request('http://127.0.0.1:4173/mcp', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body
    }));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error.' }
    });
  }
});

test('HTTP chat malformed JSON keeps the REST error response', async t => {
  const { service } = await makeService(t);
  const response = await createWebHandler(service)(new Request('http://127.0.0.1:4173/api/chat', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{'
  }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Invalid JSON.' });
});

function streams() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let output = '';
  let errors = '';
  stdout.on('data', chunk => { output += chunk; });
  stderr.on('data', chunk => { errors += chunk; });
  return { stdin, stdout, stderr, output: () => output, errors: () => errors };
}

for (const command of ['help', 'status', 'sync', 'mcp']) {
  test(`CLI ${command} ignores an invalid HTTP port environment value`, async t => {
    const directory = await temporary(t);
    const io = streams();
    const args = [command, '--store', directory];
    if (command === 'sync') {
      const manifest = join(directory, 'seeds.json');
      await writeFile(manifest, JSON.stringify({ seeds: [] }));
      args.push('--manifest', manifest);
    }
    io.stdin.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) + '\n');
    const exitCode = await runCli(args, { ...io, env: { LEGAL_PORT: 'invalid' } });
    assert.equal(exitCode, 0, io.errors());
    assert.equal(io.errors(), '');
    if (command === 'status') assert.equal(JSON.parse(io.output()).document_count, 0);
    if (command === 'sync') assert.equal(JSON.parse(io.output()).failed, 0);
    if (command === 'mcp') assert.deepEqual(JSON.parse(io.output()), { jsonrpc: '2.0', id: 1, result: {} });
    if (command === 'help') assert.match(io.output(), /Commands:/);
  });
}

test('CLI serve rejects invalid configured HTTP ports before opening a listener', async () => {
  for (const port of ['invalid', '0', '65536', '4173.5']) {
    const io = streams();
    assert.equal(await runCli(['serve'], { ...io, env: { LEGAL_PORT: port } }), 2);
    assert.equal(io.errors(), 'Invalid port.\n');
  }
});
