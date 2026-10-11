import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feature } from './helpers.mjs';

test('source policy permits attributed Citizens and eISB ingestion', async () => {
  const policy = await feature('policy', 'sourcePolicy');
  assert.equal(policy('citizens-info').storage_allowed, true);
  assert.equal(policy('eisb').storage_allowed, true);
});
test('Revised Acts requires an explicit source-specific reuse permission', async () => {
  const policy = await feature('policy', 'sourcePolicy');
  assert.equal(policy('revised-acts').storage_allowed, false);
  assert.equal(policy('revised-acts', { 'revised-acts': true }).storage_allowed, true);
});
test('BAILII and unknown sources remain blocked even with a generic permission', async () => {
  const policy = await feature('policy', 'sourcePolicy');
  assert.throws(() => policy('bailii', { '*': true }), /unsupported|blocked/i);
  assert.throws(() => policy('anything', { '*': true }), /unsupported|blocked/i);
});
test('source URL validation rejects lookalike domains, credentials and arbitrary paths', async () => {
  const check = await feature('policy', 'assertSourceUrl');
  assert.equal(check('https://www.citizensinformation.ie/en/employment/annual-leave/', 'citizens-info').hostname, 'www.citizensinformation.ie');
  for (const url of ['http://www.citizensinformation.ie/en/a/', 'https://www.citizensinformation.ie.evil.test/en/a/',
    'https://user:pass@www.citizensinformation.ie/en/a/', 'https://127.0.0.1/en/a/', 'https://www.citizensinformation.ie/admin/',
    'https://www.citizensinformation.ie:8443/en/a/']) assert.throws(() => check(url, 'citizens-info'), /URL|source|HTTPS|path|credentials|port/i);
});
