import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feature, temporary, guidanceUrl, guidanceHtml, fetchedAt, document } from './helpers.mjs';

async function setup(t) {
  const FileBackend = await feature('store', 'FileBackend');
  const createRepository = await feature('store', 'createRepository');
  return createRepository(new FileBackend(await temporary(t)));
}
const manifest = { seeds: [{ source: 'citizens-info', url: guidanceUrl }], max_pages: 10 };
const fetchPages = (pages) => async url => {
  const entry = pages[String(url)];
  return typeof entry === 'function' ? entry() : new Response(entry?.body ?? '', { status: entry?.status ?? (entry ? 200 : 404), headers: entry?.headers });
};
const robotsUrl = 'https://www.citizensinformation.ie/robots.txt';
test('successful refresh commits parsed evidence and reports indexed coverage', async t => {
  const repo = await setup(t);
  const sync = await feature('ingest', 'syncSources');
  const result = await sync(repo, manifest, { now: () => fetchedAt, delayMs: 0, fetch: fetchPages({ [robotsUrl]: { body: 'User-agent: *\nAllow: /en/' }, [guidanceUrl]: { body: guidanceHtml } }) });
  assert.equal(result.succeeded, 1);
  assert.equal((await repo.status()).document_count, 1);
  assert.equal((await repo.get(document().id)).publisher_updated_at, '2025-08-14');
});
test('robots disallow blocks ingestion before a page can enter the store', async t => {
  const repo = await setup(t);
  const sync = await feature('ingest', 'syncSources');
  const result = await sync(repo, manifest, { delayMs: 0, fetch: fetchPages({ [robotsUrl]: { body: 'User-agent: *\nDisallow: /en/employment/' }, [guidanceUrl]: { body: guidanceHtml } }) });
  assert.equal(result.failed, 1);
  assert.match(result.errors[0].reason, /robots/i);
  assert.equal((await repo.status()).document_count, 0);
});
test('robots longest matching allow wins and group choice respects the crawler', async () => {
  const allowed = await feature('ingest', 'robotsAllows');
  const rules = 'User-agent: *\nDisallow: /en/\nAllow: /en/employment/\n\nUser-agent: SomeOtherBot\nDisallow: /';
  assert.equal(allowed(rules, '/en/employment/annual-leave/'), true);
  assert.equal(allowed(rules, '/en/transport/'), false);
});
test('upstream failure preserves last usable evidence and marks it stale', async t => {
  const repo = await setup(t);
  await repo.commit([document()], 'old');
  const sync = await feature('ingest', 'syncSources');
  const result = await sync(repo, manifest, { delayMs: 0, fetch: fetchPages({ [robotsUrl]: { status: 404 }, [guidanceUrl]: { status: 403 } }) });
  assert.equal(result.failed, 1);
  const stored = await repo.get(document().id);
  assert.equal(stored.text, document().text);
  assert.equal(stored.stale, true);
});
test('redirect to a different source host is rejected', async t => {
  const repo = await setup(t);
  const sync = await feature('ingest', 'syncSources');
  const result = await sync(repo, manifest, { delayMs: 0, fetch: fetchPages({ [robotsUrl]: { status: 404 },
    [guidanceUrl]: { status: 302, headers: { location: 'https://127.0.0.1/private' } } }) });
  assert.equal(result.failed, 1);
  assert.match(result.errors[0].reason, /redirect|source|URL/i);
});
test('permission-gated source cannot be harvested through the manifest', async t => {
  const repo = await setup(t);
  const sync = await feature('ingest', 'syncSources');
  const result = await sync(repo, { seeds: [{ source: 'revised-acts', url: 'https://revisedacts.lawreform.ie/eli/1997/act/20/revised/en/html' }] }, { delayMs: 0, fetch: fetchPages({}) });
  assert.equal(result.failed, 1);
  assert.match(result.errors[0].reason, /permission/i);
});
test('oversized source response fails without replacing good data', async t => {
  const repo = await setup(t);
  const sync = await feature('ingest', 'syncSources');
  const result = await sync(repo, manifest, { delayMs: 0, maxBytes: 100, fetch: fetchPages({ [robotsUrl]: { status: 404 }, [guidanceUrl]: { body: guidanceHtml } }) });
  assert.equal(result.failed, 1);
  assert.match(result.errors[0].reason, /size|large|limit/i);
});
test('sitemap discovery stays inside configured source and subject scope', async t => {
  const repo = await setup(t);
  const sync = await feature('ingest', 'syncSources');
  const sitemap = 'https://www.citizensinformation.ie/sitemap.xml';
  const result = await sync(repo, { seeds: [], sitemaps: [{ source: 'citizens-info', url: sitemap, prefix: '/en/employment/' }], max_pages: 1 },
    { delayMs: 0, fetch: fetchPages({ [robotsUrl]: { status: 404 }, [sitemap]: { body: `<urlset><url><loc>${guidanceUrl}</loc></url><url><loc>https://evil.test/en/employment/</loc></url><url><loc>https://www.citizensinformation.ie/en/transport/</loc></url></urlset>` }, [guidanceUrl]: { body: guidanceHtml } }) });
  assert.equal(result.succeeded, 1);
  assert.equal((await repo.status()).document_count, 1);
});
test('source timeout returns a bounded failed-refresh report', async t => {
  const repo = await setup(t);
  const sync = await feature('ingest', 'syncSources');
  const result = await sync(repo, manifest, { delayMs: 0, timeoutMs: 10, fetch: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) });
  assert.equal(result.failed, 1);
  assert.match(result.errors[0].reason, /abort|timeout/i);
});
