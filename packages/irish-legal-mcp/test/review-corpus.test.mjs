import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FileBackend, createRepository } from '../src/store.mjs';
import { parseSource } from '../src/sources.mjs';
import { syncSources } from '../src/ingest.mjs';
import { createService } from '../src/service.mjs';
import { temporary, document, actUrl, actXml, guidanceUrl, guidanceHtml, fetchedAt } from './helpers.mjs';

async function setup(t) {
  const backend = new FileBackend(await temporary(t));
  return { backend, repo: createRepository(backend) };
}
test('index stores compact references while exact large historical text remains retrievable', async t => {
  const { repo, backend } = await setup(t);
  const text = 'unique long statutory wording '.repeat(5000);
  const old = await repo.commit([document({ text })], 'old bytes');
  await repo.commit([document({ text: text + ' amended' })], 'new bytes');
  const serialized = JSON.stringify((await backend.readIndex()).index);
  assert.ok(serialized.length < 10000, `Index unexpectedly holds ${serialized.length} bytes for two references`);
  assert.equal((await repo.get(document().id, { version: old.versions[0] })).text, text);
  assert.equal((await repo.search('statutory')).hits[0].text, text + ' amended');
});
test('historical publisher-date ties choose newest observation and disclose ambiguity', async t => {
  const { repo } = await setup(t);
  await repo.commit([document({ publisher_updated_at: '2025-08-14' })], 'old');
  await repo.commit([document({ text: 'Corrected annual leave entitlement wording.', publisher_updated_at: '2025-08-14', source_fetched_at: '2026-10-12T10:00:00.000Z' })], 'correction');
  const selected = await repo.get(document().id, { as_of: '2025-09-01' });
  assert.match(selected.text, /Corrected/);
  assert.ok(selected.warnings.some(w => /multiple.*publisher date/i.test(w)));
});
test('a well-formed partial Act refresh preserves the whole prior batch and marks all provisions stale', async t => {
  const { repo } = await setup(t);
  await repo.commit(parseSource({ source: 'eisb', url: actUrl, body: actXml, fetchedAt }), actXml);
  const original = await repo.get('eisb:1997/act/20');
  const partial = actXml.replace(/<sect id="SEC20">[\s\S]*?<\/sect>/, '');
  const report = await syncSources(repo, { seeds: [{ source: 'eisb', url: actUrl }] }, {
    delayMs: 0, fetch: async url => new Response(url.endsWith('robots.txt') ? '' : partial)
  });
  assert.equal(report.failed, 1);
  assert.match(report.errors[0].reason, /INCOMPLETE/);
  assert.equal((await repo.get('eisb:1997/act/20')).version, original.version);
  assert.equal((await repo.get('eisb:1997/act/20/s20')).stale, true);
  assert.equal((await repo.get('eisb:1997/act/20/s19')).stale, true);
});
test('moved guidance retires the old search hit, preserves its citation and binds later seed failures to destination', async t => {
  const { repo } = await setup(t);
  const old = await repo.commit(parseSource({ source: 'citizens-info', url: guidanceUrl, body: guidanceHtml, fetchedAt }), guidanceHtml);
  const destination = guidanceUrl.replace('annual-leave/', 'annual-leave-rights/');
  const manifest = { seeds: [{ source: 'citizens-info', url: guidanceUrl }] };
  let failing = false;
  const fetch = async url => url.endsWith('robots.txt') ? new Response('') : url === guidanceUrl ?
    new Response('', { status: 301, headers: { location: destination } }) : failing ? new Response('', { status: 503 }) : new Response(guidanceHtml);
  await syncSources(repo, manifest, { fetch, delayMs: 0 });
  const result = await repo.search('annual leave');
  assert.deepEqual(result.hits.map(d => d.id), ['citizens-info:/en/employment/annual-leave-rights/']);
  assert.equal((await repo.get(document().id, { version: old.versions[0] })).canonical_url, guidanceUrl);
  assert.equal((await repo.get(document().id)).canonical_url, destination);
  failing = true;
  await syncSources(repo, manifest, { fetch, delayMs: 0 });
  assert.equal((await repo.get(result.hits[0].id)).stale, true);
});
test('research reuses the exact search snapshot with one index read', async t => {
  const { repo, backend } = await setup(t);
  await repo.commit([document()], 'raw');
  let reads = 0;
  const readIndex = backend.readIndex.bind(backend);
  backend.readIndex = async () => { reads++; return readIndex(); };
  const result = await createService(repo).call('irish_legal_research', { query: 'annual leave' });
  assert.equal(result.documents.length, 1);
  assert.equal(reads, 1);
});
test('legacy full-document indexes remain readable and migrate without losing immutable citations', async t => {
  const { repo, backend } = await setup(t);
  const first = await repo.commit([document()], 'old');
  const { index, revision } = await backend.readIndex();
  const record = index.documents[document().id];
  const original = await repo.get(document().id);
  index.schema = 1;
  record.versions = record.versions.map(entry => ({ version: entry.version, snapshot: entry.snapshot, document: original }));
  record.latest = original;
  await backend.writeIndex(index, revision);
  assert.equal((await repo.get(document().id)).text, original.text);
  await repo.commit([document({ text: 'New corrected annual leave guidance.' })], 'new');
  assert.equal((await backend.readIndex()).index.schema, 2);
  assert.equal((await repo.get(document().id, { version: first.versions[0] })).text, original.text);
});
test('historical research retains dated evidence from a moved page without duplicate alias hits', async t => {
  const { repo } = await setup(t);
  await repo.commit([document({ publisher_updated_at: '2025-08-14' })], 'old');
  const moved = document({ id: 'citizens-info:/en/employment/moved/', canonical_url: guidanceUrl.replace('annual-leave/', 'moved/'),
    source_urls: [guidanceUrl], publisher_updated_at: '2026-01-01', source_fetched_at: '2026-01-02T00:00:00.000Z' });
  await repo.commit([moved], 'moved');
  assert.deepEqual((await repo.search('annual leave', { as_of: '2025-09-01' })).hits.map(d => d.id), [document().id]);
  assert.deepEqual((await repo.search('annual leave', { as_of: '2026-09-01' })).hits.map(d => d.id), [moved.id]);
});
test('successive moves through the same seed retire all old destinations and preserve failure aliases', async t => {
  const { repo } = await setup(t);
  await repo.commit([document()], 'old');
  const moved = suffix => document({ id: `citizens-info:/en/employment/${suffix}/`, canonical_url: guidanceUrl.replace('annual-leave/', suffix + '/'), source_urls: [guidanceUrl] });
  await repo.commit([moved('first-move')], 'first');
  await repo.commit([moved('second-move')], 'second');
  assert.deepEqual((await repo.search('annual leave')).hits.map(d => d.id), [moved('second-move').id]);
  await repo.noteFailure('citizens-info', moved('first-move').canonical_url, { checked_at: fetchedAt, reason: 'HTTP 503' });
  assert.equal((await repo.get(moved('second-move').id)).stale, true);
});
test('re-observed immutable text wins a same-publisher-date tie without changing its first fetch time', async t => {
  const { repo } = await setup(t);
  const original = document({ publisher_updated_at: '2025-08-14' });
  await repo.commit([original], 'original');
  await repo.commit([document({ text: 'Corrected annual leave wording.', publisher_updated_at: '2025-08-14', source_fetched_at: '2026-10-12T00:00:00.000Z' })], 'corrected');
  await repo.commit([{ ...original, source_fetched_at: '2026-10-13T00:00:00.000Z', source_checked_at: '2026-10-13T00:00:00.000Z' }], 'original');
  const selected = await repo.get(original.id, { as_of: '2025-09-01' });
  assert.equal(selected.text, original.text);
  assert.equal(selected.source_fetched_at, original.source_fetched_at);
});
test('historical search discloses publisher-date ambiguity across moved identities', async t => {
  const { repo } = await setup(t);
  await repo.commit([document({ publisher_updated_at: '2025-08-14' })], 'old');
  await repo.commit([document({ id: 'citizens-info:/en/employment/moved/', canonical_url: guidanceUrl.replace('annual-leave/', 'moved/'),
    source_urls: [guidanceUrl], text: 'Corrected annual leave wording.', publisher_updated_at: '2025-08-14', source_fetched_at: '2026-10-12T00:00:00.000Z' })], 'moved');
  const result = await repo.search('annual leave', { as_of: '2025-09-01' });
  assert.equal(result.hits.length, 1);
  assert.ok(result.hits[0].warnings.some(w => /multiple.*publisher date/i.test(w)));
});
