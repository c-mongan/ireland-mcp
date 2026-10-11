import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feature, fetchedAt, guidanceUrl, guidanceHtml, actUrl, actXml, revisedUrl, revisedHtml } from './helpers.mjs';

test('Citizens article retains substantive content, links, tables and source dates', async () => {
  const parseSource = await feature('sources', 'parseSource');
  const [doc] = parseSource({ source: 'citizens-info', url: guidanceUrl, body: guidanceHtml, fetchedAt });
  assert.equal(doc.title, 'Annual leave');
  assert.match(doc.text, /paid annual leave/);
  assert.match(doc.text, /52.*4 weeks/);
  assert.match(doc.text, /\[the 1997 Act\]\(https:\/\/www\.irishstatutebook\.ie/);
  assert.doesNotMatch(doc.text, /Navigation junk|Footer junk|stealSecrets/);
  assert.equal(doc.publisher_updated_at, '2025-08-14');
  assert.equal(doc.source_fetched_at, fetchedAt);
  assert.equal(doc.source_type, 'guidance');
  assert.equal(doc.legal_effective_date, null);
  assert.match(doc.licence, /CC BY 4.0/);
});

test('missing Citizens article body fails instead of returning the page title', async () => {
  const parseSource = await feature('sources', 'parseSource');
  assert.throws(() => parseSource({ source: 'citizens-info', url: guidanceUrl, body: '<h1>Annual leave</h1>', fetchedAt }), /substantive|body/i);
});

test('enacted Act produces distinct provision identities and retains footnotes', async () => {
  const parseSource = await feature('sources', 'parseSource');
  const docs = parseSource({ source: 'eisb', url: actUrl, body: actXml, fetchedAt });
  const s19 = docs.find(d => d.section === '19');
  assert.equal(s19.id, 'eisb:1997/act/20/s19');
  assert.equal(s19.content_kind, 'provision');
  assert.equal(s19.version_type, 'enacted');
  assert.match(s19.text, /Subject to the conditions/);
  assert.doesNotMatch(s19.text, /employer determines/);
  assert.deepEqual(s19.instrument, { year: 1997, type: 'act', number: 20 });
  assert.match(s19.canonical_url, /section\/19\/enacted\/en\/html$/);
});

test('malformed statute cannot be indexed as law', async () => {
  const parseSource = await feature('sources', 'parseSource');
  assert.throws(() => parseSource({ source: 'eisb', url: actUrl, body: '<html><h1>Access denied</h1></html>', fetchedAt }), /Act|statute|XML/i);
});

test('Revised Act preserves consolidation cutoff, unresolved changes and annotations', async () => {
  const parseSource = await feature('sources', 'parseSource');
  const docs = parseSource({ source: 'revised-acts', url: revisedUrl, body: revisedHtml, fetchedAt });
  const doc = docs.find(d => d.section === '19');
  assert.equal(doc.consolidated_to, '2025-01-20');
  assert.match(doc.publisher_currency_statement, /not yet implemented/);
  assert.match(doc.warnings.join(' '), /not yet implemented/);
  assert.match(doc.annotations.join(' '), /F1.*2024/);
  assert.equal(doc.legal_effective_date, null);
  assert.equal(doc.version_type, 'revised');
});

test('legal effects retain uncommenced versus operative amendment information', async () => {
  const parseSource = await feature('sources', 'parseSource');
  const body = `<main><h1>Effects on the 1997 Act</h1><table><tr><th>Provision</th><th>Effect</th><th>Commencement</th></tr>
  <tr><td>Section 19</td><td>Substituted by Act 12 of 2024 s.3</td><td>Not commenced</td></tr>
  <tr><td>Section 20</td><td>Amended by Act 2 of 2025 s.4</td><td>1 January 2026</td></tr></table></main>`;
  const [doc] = parseSource({ source: 'legislation-effects', url: 'https://www.irishstatutebook.ie/eli/isbc/1997_20.html', body, fetchedAt });
  assert.equal(doc.effects.length, 2);
  assert.equal(doc.effects[0].commencement, 'not_commenced');
  assert.equal(doc.effects[1].commenced_on, '2026-01-01');
  assert.equal(doc.effects[1].section, '20');
});

test('HTML entities decode without introducing executable markup into extracted text', async () => {
  const parseSource = await feature('sources', 'parseSource');
  const [doc] = parseSource({ source: 'citizens-info', url: guidanceUrl,
    body: '<main><h1>Leave &amp; pay</h1><p>Annual leave &#x2014; pay &lt;script&gt;not executable&lt;/script&gt;.</p></main>', fetchedAt });
  assert.equal(doc.title, 'Leave & pay');
  assert.match(doc.text, /Annual leave — pay/);
});
