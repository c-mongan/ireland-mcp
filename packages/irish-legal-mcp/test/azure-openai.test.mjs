import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feature } from './helpers.mjs';

test('Azure generation sends source text as untrusted data and requests cited JSON claims', async () => {
  const create = await feature('azure-openai', 'createAzureGenerator');
  const generate = create({ endpoint: 'https://legal-test.openai.azure.com', deployment: 'test', apiKey: 'test-only-key', fetch: async (url, request) => {
    assert.match(url, /deployments\/test\/chat\/completions/);
    const body = JSON.parse(request.body);
    assert.match(body.messages[0].content, /untrusted|instructions/i);
    assert.equal(body.response_format.type, 'json_object');
    assert.equal(body.messages[1].role, 'user');
    assert.equal(JSON.parse(body.messages[1].content).evidence[0].text, 'Example source text');
    return Response.json({ choices: [{ message: { content: JSON.stringify({ claims: [{ text: 'Example', citation_id: 'known', quote: 'Example source text' }] }) } }] });
  } });
  const result = await generate({ question: 'Leave?', evidence: [{ id: 'known', text: 'Example source text' }], retrieved_content_is_untrusted: true });
  assert.equal(result.claims[0].citation_id, 'known');
});
test('Azure provider supports an injected managed-identity bearer token', async () => {
  const create = await feature('azure-openai', 'createAzureGenerator');
  const generate = create({ endpoint: 'https://legal-test.openai.azure.com', deployment: 'test', getToken: async () => 'test-token', fetch: async (_url, request) => {
    assert.equal(request.headers.authorization, 'Bearer test-token');
    assert.equal(request.headers['api-key'], undefined);
    return Response.json({ choices: [{ message: { content: '{"claims":[]}' } }] });
  } });
  assert.deepEqual(await generate({ evidence: [] }), { claims: [] });
});
test('invalid Azure endpoint and failed provider response do not expose credentials', async () => {
  const create = await feature('azure-openai', 'createAzureGenerator');
  assert.throws(() => create({ endpoint: 'https://127.0.0.1/private', deployment: 'test', apiKey: 'secret' }), /endpoint/i);
  const generate = create({ endpoint: 'https://legal-test.openai.azure.com', deployment: 'test', apiKey: 'secret', fetch: async () => new Response('credential: secret', { status: 401 }) });
  await assert.rejects(generate({ evidence: [] }), error => error.message.includes('401') && !error.message.includes('secret'));
});
