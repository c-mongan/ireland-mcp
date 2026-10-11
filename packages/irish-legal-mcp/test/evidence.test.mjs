import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feature, document, fetchedAt } from './helpers.mjs';

test('serve time does not replace the source fetch/check or legal version date', async () => {
  const evidence = await feature('evidence', 'describeEvidence');
  const result = evidence(document({ version: 'abc', consolidated_to: '2025-01-20', source_type: 'legislation', version_type: 'revised' }), { now: '2026-10-12T12:00:00.000Z' });
  assert.equal(result.source_fetched_at, fetchedAt);
  assert.equal(result.source_checked_at, fetchedAt);
  assert.equal(result.served_at, '2026-10-12T12:00:00.000Z');
  assert.equal(result.consolidated_to, '2025-01-20');
  assert.equal(result.current_law_verified, false);
});
test('enacted text never implies current amended law or commencement', async () => {
  const evidence = await feature('evidence', 'describeEvidence');
  const result = evidence(document({ source_type: 'legislation', version_type: 'enacted' }));
  assert.equal(result.currentness, 'as_enacted');
  assert.equal(result.legal_effective_date, null);
  assert.match(result.warnings.join(' '), /amendment|commencement/i);
});
test('publisher unresolved-change warning takes precedence over fresh download', async () => {
  const evidence = await feature('evidence', 'describeEvidence');
  const result = evidence(document({ source_type: 'legislation', version_type: 'revised', warnings: ['Changes not yet incorporated by editors.'] }));
  assert.equal(result.currentness, 'unresolved_changes');
  assert.equal(result.current_law_verified, false);
});
test('guidance is labelled explanatory and citation includes version and attribution', async () => {
  const evidence = await feature('evidence', 'describeEvidence');
  const result = evidence(document({ version: '123' }));
  assert.equal(result.currentness, 'guidance');
  assert.equal(result.citation.version, '123');
  assert.equal(result.citation.url, document().canonical_url);
  assert.equal(result.citation.attribution, document().attribution);
});
