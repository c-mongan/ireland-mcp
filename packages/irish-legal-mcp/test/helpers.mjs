import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function feature(file, name) {
  let module;
  try { module = await import(`../src/${file}.mjs`); } catch (error) {
    assert.fail(`Missing implementation ${file}: ${error.message}`);
  }
  assert.equal(typeof module[name], 'function', `Missing implementation ${file}.${name}`);
  return module[name];
}
export async function temporary(t) {
  const path = await mkdtemp(join(tmpdir(), 'irish-legal-test-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
export const fetchedAt = '2026-10-11T10:00:00.000Z';
export const guidanceUrl = 'https://www.citizensinformation.ie/en/employment/annual-leave/';
export const guidanceHtml = `<!doctype html><html><head><title>Annual leave</title></head><body>
<nav>Navigation junk</nav><main id="content"><h1>Annual leave</h1>
<p>Employees have an entitlement to paid annual leave.</p><p>See <a href="https://www.irishstatutebook.ie/eli/1997/act/20/enacted/en/html">the 1997 Act</a>.</p>
<table><tr><th>Weeks</th><th>Leave</th></tr><tr><td>52</td><td>4 weeks</td></tr></table>
<p>Page edited: 14 August 2025</p><script>stealSecrets()</script></main><footer>Footer junk</footer></body></html>`;
export const actUrl = 'https://www.irishstatutebook.ie/eli/1997/act/20/enacted/en/xml';
export const actXml = `<act><metadata><title>ORGANISATION OF WORKING TIME ACT, 1997</title><dateofenactment>19970507</dateofenactment></metadata><body>
<sect id="SEC19"><number>19.</number><title>Entitlement to annual leave</title><p>An employee shall be entitled to paid annual leave.<fn>Subject to the conditions in this section.</fn></p></sect>
<sect id="SEC20"><number>20.</number><title>Times and pay</title><p>The employer determines the times of annual leave.</p></sect></body></act>`;
export const revisedUrl = 'https://revisedacts.lawreform.ie/eli/1997/act/20/revised/en/html';
export const revisedHtml = `<html><body><main><h1>Organisation of Working Time Act 1997</h1><p>Updated to 20 January 2025</p>
<div class="changes">Changes to legislation: as of 17 September 2026 there are changes not yet implemented by the editors.</div>
<div class="section" id="sec19"><h2>19. Entitlement to annual leave</h2><p>Employees are entitled to paid annual leave.</p>
<div class="annotation">F1 Substituted by Act 12 of 2024, section 3.</div></div></main></body></html>`;
export function document(overrides = {}) {
  return { id: 'citizens-info:/en/employment/annual-leave/', title: 'Annual leave', text: 'Employees have paid annual leave rights.',
    source_id: 'citizens-info', source_type: 'guidance', jurisdiction: 'IE', publisher: 'Citizens Information Board',
    canonical_url: guidanceUrl, licence: 'CC BY 4.0 (third-party material excluded)', attribution: 'Citizens Information Board',
    content_kind: 'article', version_type: 'guidance', instrument: null, section: null, legal_effective_date: null,
    consolidated_to: null, publisher_updated_at: null, publisher_currency_statement: null, warnings: [], annotations: [], links: [], effects: [],
    source_fetched_at: fetchedAt, source_checked_at: fetchedAt, ...overrides };
}

export async function makeService(t) {
  const FileBackend = await feature('store', 'FileBackend');
  const createRepository = await feature('store', 'createRepository');
  const parseSource = await feature('sources', 'parseSource');
  const createService = await feature('service', 'createService');
  const repo = createRepository(new FileBackend(await temporary(t)));
  await repo.commit([document({ publisher_updated_at: '2025-08-14' })], 'guidance raw');
  await repo.commit(parseSource({ source: 'eisb', url: actUrl, body: actXml, fetchedAt }), actXml);
  return { repo, service: createService(repo) };
}
