import test from 'node:test';
import assert from 'node:assert/strict';
import { rank, words } from '../src/index.mjs';
import { feature } from './helpers.mjs';

const reference = (id, search, overrides = {}) => ({
  id, title: '', text: '', source_id: 'citizens-info', source_type: 'guidance', search, ...overrides,
});
const resultFields = rows => rows.map(({ id, score, snippet }) => ({ id, score, snippet }));

test('search metadata preserves exact Unicode term frequencies and the original snippet', async () => {
  const buildSearchMetadata = await feature('index', 'buildSearchMetadata');
  const doc = {
    title: 'Annual LEAVE and Éireann',
    text: 'Annual leave, LEAVE. Éireann 1997 the rights rights. '.repeat(12),
  };
  const search = buildSearchMetadata(doc);
  assert.deepEqual(search.terms, { annual: 13, leave: 25, 'éireann': 13, 1997: 12, rights: 24 });
  assert.deepEqual(search.title_terms, ['annual', 'leave', 'éireann']);
  assert.equal(search.token_count, 87);
  assert.equal(search.snippet, doc.text.slice(0, 450));
  assert.deepEqual(words('The ÉIREANN, 1997 and laws law.'), ['éireann', '1997', 'laws', 'law']);
});

test('metadata-only ranking preserves BM25 scores and the title boost', () => {
  const hits = rank([
    reference('a-body', { terms: { leave: 1, protection: 1 }, title_terms: ['protection'], token_count: 2, snippet: 'Leave' }),
    reference('z-title', { terms: { leave: 1, protection: 1 }, title_terms: ['leave'], token_count: 2, snippet: 'Protection' }),
  ], 'leave');
  assert.deepEqual(hits.map(hit => hit.id), ['z-title', 'a-body']);
  const idf = Math.log(1 + 0.5 / 2.5);
  assert.ok(Math.abs(hits[0].score - 3 * idf) < 1e-12);
  assert.ok(Math.abs(hits[1].score - idf) < 1e-12);
  assert.equal(hits[0].snippet, 'Protection');
});

test('metadata-only ranking never reads document body text', () => {
  const doc = reference('annual-leave', {
    terms: { annual: 2, leave: 3 }, title_terms: ['annual', 'leave'], token_count: 5, snippet: 'Paid annual leave.',
  });
  Object.defineProperty(doc, 'text', { enumerable: false, get() { throw new Error('Document body must stay unloaded'); } });
  let hits;
  assert.doesNotThrow(() => { hits = rank([doc], 'annual leave'); });
  assert.equal(hits[0].id, 'annual-leave');
  assert.equal(hits[0].snippet, 'Paid annual leave.');
});

test('ranking compact metadata matches full documents for relevance, filters, limits, and ties', async () => {
  const buildSearchMetadata = await feature('index', 'buildSearchMetadata');
  const documents = [
    { id: 'b', title: 'Leave protection', text: 'Leave rights.', source_id: 'citizens-info', source_type: 'guidance' },
    { id: 'a', title: 'Leave protection', text: 'Leave rights.', source_id: 'citizens-info', source_type: 'guidance' },
    { id: 'c', title: 'Annual leave Act', text: 'Workers receive annual leave leave leave.', source_id: 'eisb', source_type: 'legislation' },
    { id: 'd', title: 'Tax', text: 'Income and revenue.', source_id: 'eisb', source_type: 'legislation' },
  ];
  const references = documents.map(({ text, ...doc }) => ({ ...doc, search: buildSearchMetadata({ ...doc, text }) }));
  for (const options of [{}, { limit: 1 }, { source: 'eisb' }, { source_type: 'guidance' }]) {
    assert.deepEqual(resultFields(rank(references, 'leave rights', options)), resultFields(rank(documents, 'leave rights', options)));
  }
  assert.deepEqual(rank(references, 'leave rights', { source_type: 'guidance' }).map(hit => hit.id), ['a', 'b']);
  assert.equal(rank(references, 'leave', { limit: 1 }).length, 1);
});

test('metadata ranking uses exact words, ignores stop words, and retains Unicode matches', () => {
  const documents = [
    reference('accent', { terms: { 'éireann': 2, law: 1 }, title_terms: ['éireann'], token_count: 3, snippet: 'Éireann law' }),
    reference('plural', { terms: { laws: 1 }, title_terms: [], token_count: 1, snippet: 'Laws' }),
  ];
  assert.deepEqual(rank(documents, 'the ÉIREANN').map(hit => hit.id), ['accent']);
  assert.deepEqual(rank(documents, 'law').map(hit => hit.id), ['accent']);
  assert.deepEqual(rank(documents, 'laws').map(hit => hit.id), ['plural']);
  assert.deepEqual(rank(documents, 'the and of'), []);
});

test('ranking retains query and result-limit validation', () => {
  for (const query of ['', '   ', null, 'a'.repeat(501)]) assert.throws(() => rank([], query), /BAD_ARGS: query/);
  for (const limit of [0, 51, 1.5, '10']) assert.throws(() => rank([], 'leave', { limit }), /BAD_ARGS: limit/);
  assert.deepEqual(rank([], 'l'.repeat(500), { limit: 50 }), []);
});

test('metadata retains legal terms that share names with object properties', async () => {
  const buildSearchMetadata = await feature('index', 'buildSearchMetadata');
  const search = buildSearchMetadata({ title: 'Constructor', text: 'Constructor liability.' });
  assert.equal(search.terms.constructor, 2);
  const hits = rank([
    reference('builder', search),
    reference('other', { terms: { liability: 1 }, title_terms: [], token_count: 1, snippet: 'Liability' }),
  ], 'constructor');
  assert.deepEqual(hits.map(hit => hit.id), ['builder']);
});

test('metadata accepts the unique-term boundary and fails explicitly beyond it', async () => {
  const buildSearchMetadata = await feature('index', 'buildSearchMetadata');
  const text = Array.from({ length: 12_000 }, (_, i) => `t${i}`).join(' ');
  const search = buildSearchMetadata({ title: '', text });
  assert.equal(Object.keys(search.terms).length, 12_000);
  assert.equal(search.terms.t11999, 1);
  assert.equal(search.token_count, 12_000);
  assert.ok(Buffer.byteLength(JSON.stringify(search), 'utf8') <= 128 * 1024);
  assert.throws(() => buildSearchMetadata({ title: '', text: `${text} finallegalterm` }), error => {
    assert.equal(error.code, 'INDEX_LIMIT');
    assert.match(error.message, /^INDEX_LIMIT:/);
    return true;
  });
});

test('metadata fails explicitly when UTF-8 serialization exceeds 128 KiB', async () => {
  const buildSearchMetadata = await feature('index', 'buildSearchMetadata');
  assert.throws(() => buildSearchMetadata({ title: '', text: 'é'.repeat(66_000) }), error => {
    assert.equal(error.code, 'INDEX_LIMIT');
    assert.match(error.message, /^INDEX_LIMIT:/);
    return true;
  });
});
