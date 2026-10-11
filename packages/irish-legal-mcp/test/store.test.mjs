import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { feature, temporary, document, fetchedAt } from './helpers.mjs';

async function repository(t) {
  const FileBackend = await feature('store', 'FileBackend');
  const createRepository = await feature('store', 'createRepository');
  const path = await temporary(t);
  return { path, backend: new FileBackend(path), repo: createRepository(new FileBackend(path)) };
}
test('a committed document and raw source survive a new repository instance', async t => {
  const { repo, path } = await repository(t);
  const result = await repo.commit([document()], '<main>original raw source</main>');
  const createRepository = await feature('store', 'createRepository');
  const FileBackend = await feature('store', 'FileBackend');
  const loaded = await createRepository(new FileBackend(path)).get(document().id);
  assert.equal(loaded.text, document().text);
  assert.equal(loaded.version, result.versions[0]);
  assert.equal(loaded.source_fetched_at, fetchedAt);
  assert.match(await readFile(join(path, 'raw', loaded.raw_hash + '.txt'), 'utf8'), /original raw source/);
});
test('unchanged successful checks retain original fetch time and version', async t => {
  const { repo } = await repository(t);
  await repo.commit([document()], 'same bytes');
  const first = await repo.get(document().id);
  await repo.commit([document({ source_fetched_at: '2026-10-12T10:00:00.000Z', source_checked_at: '2026-10-12T10:00:00.000Z' })], 'same bytes');
  const second = await repo.get(document().id);
  assert.equal(second.version, first.version);
  assert.equal(second.source_fetched_at, fetchedAt);
  assert.equal(second.source_checked_at, '2026-10-12T10:00:00.000Z');
});
test('changed source preserves immutable prior versions for exact retrieval', async t => {
  const { repo, path } = await repository(t);
  const first = await repo.commit([document()], 'old raw');
  await repo.commit([document({ text: 'New annual leave text', publisher_updated_at: '2026-10-12', source_fetched_at: '2026-10-12T10:00:00.000Z' })], 'new raw');
  assert.equal((await repo.get(document().id, { version: first.versions[0] })).text, document().text);
  assert.equal((await repo.get(document().id)).text, 'New annual leave text');
  assert.equal((await readdir(join(path, 'documents'))).length, 2);
});
test('historical selection rejects dates before known evidence instead of returning latest', async t => {
  const { repo } = await repository(t);
  await repo.commit([document({ publisher_updated_at: '2025-08-14' })], 'old');
  await repo.commit([document({ text: 'Changed text', publisher_updated_at: '2026-10-12', source_fetched_at: '2026-10-12T10:00:00.000Z' })], 'new');
  assert.equal((await repo.get(document().id, { as_of: '2025-09-01' })).text, document().text);
  await assert.rejects(repo.get(document().id, { as_of: '2024-01-01' }), /HISTORICAL_UNAVAILABLE/);
});
test('snapshot write failure never publishes a partially updated index', async t => {
  const { repo, backend } = await repository(t);
  await repo.commit([document()], 'good');
  const createRepository = await feature('store', 'createRepository');
  const broken = createRepository({
    readIndex: () => backend.readIndex(), writeIndex: (i, r) => backend.writeIndex(i, r),
    readSnapshot: key => backend.readSnapshot(key),
    writeSnapshot: async () => { throw new Error('disk full'); }
  });
  await assert.rejects(broken.commit([document({ text: 'Bad new text' })], 'bad'), /disk full/);
  assert.equal((await repo.get(document().id)).text, document().text);
});
test('concurrent commits either preserve both documents or report a retryable conflict', async t => {
  const { repo } = await repository(t);
  const one = document();
  const two = document({ id: 'citizens-info:/en/employment/working-time/', title: 'Working time' });
  const results = await Promise.allSettled([repo.commit([one], 'one'), repo.commit([two], 'two')]);
  const failures = results.filter(r => r.status === 'rejected');
  for (const failure of failures) assert.match(failure.reason.message, /CONFLICT/);
  for (let i = 0; i < results.length; i++) if (results[i].status === 'rejected') await repo.commit([[one, two][i]], String(i));
  assert.equal((await repo.status()).document_count, 2);
});
test('search ranks relevant documents and exposes coverage without treating no hits as no law', async t => {
  const { repo } = await repository(t);
  await repo.commit([document(), document({ id: 'citizens-info:/en/transport/', title: 'Bus travel', text: 'Travel by bus.' })], 'raw');
  const results = await repo.search('annual leave');
  assert.equal(results.hits[0].id, document().id);
  assert.equal(results.hits.length, 1);
  assert.equal(results.coverage.document_count, 2);
  const missing = await repo.search('unobtainium');
  assert.equal(missing.hits.length, 0);
  assert.match(missing.coverage.note, /indexed|coverage/i);
});
test('failed refresh keeps the document and exposes stale source status', async t => {
  const { repo } = await repository(t);
  await repo.commit([document()], 'raw');
  await repo.noteFailure('citizens-info', document().canonical_url, { checked_at: '2026-10-12T10:00:00.000Z', reason: 'HTTP 403' });
  assert.equal((await repo.get(document().id)).stale, true);
  assert.match((await repo.status()).sources['citizens-info'].last_error, /403/);
});
test('invalid document identity and prototype keys cannot enter the index', async t => {
  const { repo } = await repository(t);
  await assert.rejects(repo.commit([document({ id: '__proto__' })], 'raw'), /identity|document/i);
  await assert.rejects(repo.get('../../secrets'), /identity|document/i);
});
