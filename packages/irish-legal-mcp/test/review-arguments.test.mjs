import assert from 'node:assert/strict';
import test from 'node:test';
import { sourcePolicy } from '../src/policy.mjs';
import { handleRpc } from '../src/protocol.mjs';
import { createService } from '../src/service.mjs';
import { makeService } from './helpers.mjs';

test('prototype property names cannot select or enable a source policy', () => {
  for (const source of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty']) {
    assert.throws(() => sourcePolicy(source, { [source]: true }), /Unsupported or blocked source/);
  }
  assert.equal(sourcePolicy('citizens-info').storage_allowed, true);
  assert.equal(sourcePolicy('revised-acts').storage_allowed, false);
});

test('malformed fetch identities return BAD_ARGS before reaching repository lookup', async (t) => {
  const { repo } = await makeService(t);
  const lookedUp = [];
  const service = createService({ ...repo, get: async (...args) => { lookedUp.push(args[0]); return repo.get(...args); } });
  for (const name of ['irish_legal_fetch', 'citizens_info_get_article']) {
    for (const id of ['../../secrets', 'constructor', 'citizens-info:../../secrets', 'citizens-info:/en/employment/..',
      'citizens-info:/en/%2e%2e/secrets', 'eisb:1997/act/20/s19/../../secrets']) {
      await assert.rejects(service.call(name, { id }), /^Error: BAD_ARGS:/, `${name} must reject ${id} as bad arguments`);
    }
  }
  assert.deepEqual(lookedUp, [], 'Invalid fetch identities must not reach repository.get');
});

test('public MCP fetch reports malformed document IDs as invalid params instead of an internal failure', async (t) => {
  const { service } = await makeService(t);
  for (const [name, id] of [['irish_legal_fetch', '../../secrets'], ['citizens_info_get_article', 'citizens-info:../../secrets']]) {
    const response = await handleRpc(service, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { id } } });
    assert.equal(response.error?.code, -32602, `${name} must return invalid params`);
    assert.match(response.error.message, /^BAD_ARGS:/);
  }
});

test('public fetch schemas accept existing guidance, whole Acts and exact provision identities', async (t) => {
  const { service } = await makeService(t);
  for (const [name, id] of [
    ['irish_legal_fetch', 'eisb:1997/act/20'],
    ['irish_legal_fetch', 'eisb:1997/act/20/s19'],
    ['citizens_info_get_article', 'citizens-info:/en/employment/annual-leave/']
  ]) {
    const response = await handleRpc(service, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: { id } } });
    assert.equal(response.result?.structuredContent?.id, id);
  }
});
