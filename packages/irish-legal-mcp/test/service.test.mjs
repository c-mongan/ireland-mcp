import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeService } from './helpers.mjs';
test('catalogue distinguishes guidance, enacted legislation and permission-gated consolidation', async t => {
  const { service } = await makeService(t);
  const result = await service.call('irish_legal_catalogue', {});
  assert.equal(result.sources.find(s => s.id === 'citizens-info').type, 'guidance');
  assert.equal(result.sources.find(s => s.id === 'revised-acts').storage_allowed, false);
  assert.equal(result.coverage.document_count, 4);
});
test('exact provision lookup returns its own text, canonical citation and currentness', async t => {
  const { service } = await makeService(t);
  const doc = await service.call('irish_legal_get_provision', { year: 1997, number: 20, section: '19', version_type: 'enacted' });
  assert.equal(doc.id, 'eisb:1997/act/20/s19');
  assert.equal(doc.section, '19');
  assert.equal(doc.currentness, 'as_enacted');
  assert.doesNotMatch(doc.text, /employer determines/);
  assert.equal(doc.citation.version, doc.version);
});
test('unavailable revised provision never silently falls back to the enacted text', async t => {
  const { service } = await makeService(t);
  await assert.rejects(service.call('irish_legal_get_provision', { year: 1997, number: 20, section: '19', version_type: 'revised' }), /NOT_FOUND|unavailable/i);
});
test('citizen tools only return guidance and fetch rejects a legislation identity', async t => {
  const { service } = await makeService(t);
  const result = await service.call('citizens_info_search', { query: 'annual leave' });
  assert.ok(result.hits.length > 0);
  assert.ok(result.hits.every(h => h.source_type === 'guidance'));
  await assert.rejects(service.call('citizens_info_get_article', { id: 'eisb:1997/act/20/s19' }), /BAD_ARGS/);
});
test('research bundle preserves both legal provisions and explanatory guidance', async t => {
  const { service } = await makeService(t);
  const result = await service.call('irish_legal_research', { query: 'annual leave' });
  assert.ok(result.documents.some(d => d.source_type === 'guidance'));
  assert.ok(result.documents.some(d => d.content_kind === 'provision'));
  assert.equal(result.current_law_verified, false);
  assert.ok(result.documents.every(d => d.citation.url && d.version));
});
test('tool validation rejects invalid section identities and unknown operations', async t => {
  const { service } = await makeService(t);
  await assert.rejects(service.call('irish_legal_get_provision', { year: 1997, number: 20, section: '../../private' }), /BAD_ARGS/);
  await assert.rejects(service.call('refresh_all', {}), /UNKNOWN_TOOL/);
});
