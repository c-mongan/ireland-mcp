import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { feature, makeService, fetchedAt, actXml, actUrl, revisedHtml, revisedUrl, temporary, document } from './helpers.mjs';

test('a date in an enactment column is never inferred to be a commencement date', async () => {
  const parse = await feature('sources', 'parseSource');
  const [doc] = parse({ source: 'legislation-effects', url: 'https://www.irishstatutebook.ie/eli/isbc/1997_20.html', fetchedAt,
    body: '<main><h1>Effects</h1><table><tr><th>Provision</th><th>Amending legislation</th><th>Enacted on</th></tr><tr><td>Section 19</td><td>Act 12 of 2024</td><td>1 January 2026</td></tr></table></main>' });
  assert.equal(doc.effects[0].commencement, 'unknown');
  assert.equal(doc.effects[0].commenced_on, null);
});
test('invalid calendar dates are rejected rather than normalized into historical requests', async t => {
  const { service } = await makeService(t);
  await assert.rejects(service.call('irish_legal_fetch', { id: 'citizens-info:/en/employment/annual-leave/', as_of: '2026-02-30' }), /BAD_ARGS/);
});
test('substantive legal text is marked truncated when bounded for transport', async t => {
  const { repo, service } = await makeService(t);
  const doc = await repo.get('eisb:1997/act/20/s19');
  await repo.commit([{ ...doc, text: 'Annual leave entitlement. '.repeat(3000) }], 'very long provision');
  const result = await service.call('irish_legal_get_provision', { year: 1997, number: 20, section: '19', version_type: 'enacted' });
  assert.equal(result.text_truncated, true);
  assert.ok(result.text.length <= 20000);
  assert.equal(result.content_kind, 'provision');
});
test('truncated XML cannot replace complete legal provisions', async () => {
  const parse = await feature('sources', 'parseSource');
  assert.throws(() => parse({ source: 'eisb', url: actUrl, fetchedAt, body: actXml.slice(0, actXml.indexOf('<fn>')) }), /XML|unclosed|incomplete/i);
});
test('failed whole-Act refresh marks every derived provision stale and recovery clears it', async t => {
  const { repo } = await makeService(t);
  await repo.noteFailure('eisb', actUrl.replace(/xml$/, 'html'), { checked_at: fetchedAt, reason: 'HTTP 410' });
  assert.equal((await repo.get('eisb:1997/act/20/s19')).stale, true);
  const parse = await feature('sources', 'parseSource');
  await repo.commit(parse({ source: 'eisb', url: actUrl, fetchedAt, body: actXml }), actXml);
  assert.equal((await repo.get('eisb:1997/act/20/s19')).stale, false);
});
test('actual Revised Acts warning wording remains unresolved evidence', async () => {
  const parse = await feature('sources', 'parseSource');
  const [doc] = parse({ source: 'revised-acts', url: revisedUrl, fetchedAt,
    body: revisedHtml.replace('there are changes not yet implemented by the editors.', 'there are changes to this Act which have not been implemented by the Revised Acts editorial team.') });
  assert.match(doc.warnings.join(' '), /not been implemented/);
});
test('real commencement table uses its dated commencement column and currency heading', async () => {
  const parse = await feature('sources', 'parseSource');
  const [doc] = parse({ source: 'legislation-effects', url: 'https://www.irishstatutebook.ie/eli/isbc/1997_20.html', fetchedAt,
    body: '<main><h1>Commencements</h1><h3>Updated to 17 September 2026</h3><table><tr><th>Section</th><th>Commencement</th><th>Commencement Information</th></tr><tr><td>19</td><td>1 January 2026</td><td>S.I. No. 123 of 2025</td></tr></table></main>' });
  assert.equal(doc.effects[0].section, '19');
  assert.equal(doc.effects[0].commenced_on, '2026-01-01');
  assert.equal(doc.publisher_updated_at, '2026-09-17');
});
test('stored Irish XML fixture retains legislative quotation and dash punctuation', async () => {
  const parse = await feature('sources', 'parseSource');
  const body = await readFile(new URL('../../../src/sources/legislation/fixtures/act-2018-7.xml', import.meta.url), 'utf8');
  const docs = parse({ source: 'eisb', url: 'https://www.irishstatutebook.ie/eli/2018/act/7/enacted/en/xml', fetchedAt, body });
  assert.equal(docs.length, 4); // The repository fixture contains three complete sections.
  assert.match(docs.find(d => d.section === '2').text, /“[^”]+”/);
  assert.match(docs[0].text, /—/);
});
test('corrupt pre-existing immutable snapshots abort publication of the index', async t => {
  const FileBackend = await feature('store', 'FileBackend');
  const createRepository = await feature('store', 'createRepository');
  const path = await temporary(t);
  const raw = 'complete source body';
  const digest = createHash('sha256').update(raw).digest('hex');
  await mkdir(join(path, 'raw'));
  await writeFile(join(path, 'raw', digest + '.txt'), 'truncated');
  const repo = createRepository(new FileBackend(path));
  await assert.rejects(repo.commit([document()], raw), /corrupt|mismatch|integrity/i);
  assert.equal((await repo.status()).document_count, 0);
});
test('historical research ranks the requested older text even when latest wording differs', async t => {
  const { repo, service } = await makeService(t);
  await repo.commit([document({ text: 'Employees received holidaypaybonus under this guidance.', publisher_updated_at: '2025-01-01' })], 'old bonus');
  await repo.commit([document({ text: 'Employees now receive ordinary annual leave only.', publisher_updated_at: '2026-01-01' })], 'new leave');
  const result = await service.call('irish_legal_research', { query: 'holidaypaybonus', as_of: '2025-06-01' });
  assert.equal(result.documents.length, 1);
  assert.match(result.documents[0].text, /holidaypaybonus/);
});
test('invalid JSON-RPC identifiers are reported with a null response identifier', async t => {
  const { service } = await makeService(t);
  const handleRpc = await feature('protocol', 'handleRpc');
  assert.equal((await handleRpc(service, { jsonrpc: '2.0', method: 'ping', id: { bad: true } })).id, null);
});
