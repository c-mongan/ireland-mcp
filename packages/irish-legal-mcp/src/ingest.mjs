import { sourcePolicy, assertSourceUrl } from './policy.mjs';
import { parseSource } from './sources.mjs';
import { tree, findAll, text } from './html.mjs';
import { randomUUID } from 'node:crypto';

const AGENT = 'IrelandLegalMCP';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function robotsAllows(body, path, agent = AGENT) {
  const groups = [];
  let group = { agents: [], rules: [] };
  for (const line of body.split(/\r?\n/)) {
    const [name, ...parts] = line.replace(/#.*/, '').split(':');
    const value = parts.join(':').trim();
    const key = name.trim().toLowerCase();
    if (key === 'user-agent') {
      if (group.rules.length) { groups.push(group); group = { agents: [], rules: [] }; }
      group.agents.push(value.toLowerCase());
    } else if ((key === 'allow' || key === 'disallow') && value && group.agents.length) group.rules.push({ allow: key === 'allow', value });
  }
  groups.push(group);
  const specificity = g => Math.max(-1, ...g.agents.map(a => a === '*' ? 0 : agent.toLowerCase().includes(a) ? a.length : -1));
  const best = Math.max(...groups.map(specificity));
  const rules = groups.filter(g => specificity(g) === best && best >= 0).flatMap(g => g.rules).filter(rule => {
    const escaped = rule.value.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}`).test(path);
  }).sort((a,b) => b.value.replace(/\*/g, '').length - a.value.replace(/\*/g, '').length || Number(b.allow) - Number(a.allow));
  return rules[0]?.allow ?? true;
}

async function readBounded(response, maxBytes) {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new Error('Source response exceeds size limit.');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const parts = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new Error('Source response exceeds size limit.'); }
      parts.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(parts).toString('utf8');
}

export async function syncSources(repository, manifest, options = {}) {
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date().toISOString());
  const maxBytes = Math.min(options.maxBytes ?? 4 * 1024 * 1024, 4 * 1024 * 1024);
  const timeoutMs = Math.min(options.timeoutMs ?? 15000, 30000);
  const delayMs = Math.min(options.delayMs ?? 800, 5000);
  const maxPages = manifest.max_pages ?? 30;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 1000) throw new Error('max_pages must be between 1 and 1000.');
  const report = { succeeded: 0, failed: 0, skipped: 0, documents: 0, errors: [], checked_at: now() };
  const robots = new Map();
  const request = async (url, limit) => {
    if (delayMs > 0) await pause(delayMs);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Source timeout.')), timeoutMs);
    try {
      const response = await fetcher(url.href, { redirect: 'manual', signal: controller.signal,
        headers: { 'user-agent': `${AGENT}/0.1 (+https://github.com/c-mongan/ireland-mcp)` } });
      return { response, body: await readBounded(response, limit) };
    } finally { clearTimeout(timer); }
  };
  const checkRobots = async url => {
    if (!robots.has(url.origin)) {
      const { response, body } = await request(new URL('/robots.txt', url), 128 * 1024);
      if (response.status === 404 || response.status === 410) robots.set(url.origin, '');
      else if (!response.ok) throw new Error(`robots.txt unavailable: HTTP ${response.status}; ingestion stopped.`);
      else robots.set(url.origin, body);
    }
    if (!robotsAllows(robots.get(url.origin), url.pathname + url.search)) throw new Error('Path disallowed by robots.txt.');
  };
  const loadPage = async (seed, depth = 0, aliases = []) => {
    if (depth > 3) throw new Error('Too many source redirects.');
    const url = assertSourceUrl(seed.url, seed.source);
    const policy = sourcePolicy(seed.source, options.permissions);
    if (!policy.storage_allowed) throw new Error('Source-specific reuse permission is required before storage.');
    await checkRobots(url);
    const result = await request(url, maxBytes);
    if (result.response.status >= 300 && result.response.status < 400) {
      const location = result.response.headers.get('location');
      if (!location) throw new Error('Source redirect has no destination.');
      const redirected = assertSourceUrl(new URL(location, url).href, seed.source);
      return loadPage({ ...seed, url: redirected.href }, depth + 1, [...aliases, url.href]);
    }
    if (!result.response.ok) throw new Error(`Source HTTP ${result.response.status}.`);
    return { body: result.body, url: url.href, aliases };
  };
  const seeds = [...(manifest.seeds ?? [])];
  for (const sitemap of manifest.sitemaps ?? []) {
    try {
      const policy = sourcePolicy(sitemap.source, options.permissions);
      const url = new URL(sitemap.url);
      if (!policy.storage_allowed || url.protocol !== 'https:' || url.hostname !== policy.host || url.port || url.username || url.password || url.search || !/^\/sitemap[a-z0-9_-]*\.xml$/i.test(url.pathname))
        throw new Error('Sitemap URL or reuse permission is outside the permitted source.');
      await checkRobots(url);
      const result = await request(url, maxBytes);
      if (!result.response.ok) throw new Error(`Sitemap HTTP ${result.response.status}.`);
      const entries = findAll(tree(result.body), n => n.tag === 'loc').map(n => text(n, url));
      for (const entry of entries) {
        try {
          const candidate = assertSourceUrl(entry, sitemap.source);
          if (candidate.pathname.startsWith(sitemap.prefix ?? '/en/')) seeds.push({ source: sitemap.source, url: candidate.href });
        } catch { /* sitemap may contain other languages and sources */ }
      }
    } catch (error) { report.errors.push({ source: sitemap.source, url: sitemap.url, reason: error.message }); report.failed++; }
  }
  const unique = [...new Map(seeds.map(seed => [seed.source + ':' + seed.url, seed])).values()];
  report.skipped = Math.max(0, unique.length - maxPages);
  for (const seed of unique.slice(0, maxPages)) {
    try {
      const { body, url, aliases } = await loadPage(seed);
      const documents = parseSource({ source: seed.source, url, body, fetchedAt: now() }).map(doc => ({ ...doc,
        source_urls: [...new Set([doc.source_url, ...aliases.map(alias => alias.replace(/\/xml$/, '/html'))])] }));
      await repository.commit(documents, body);
      report.succeeded++;
      report.documents += documents.length;
    } catch (error) {
      const reason = error.message || 'Source refresh failed.';
      report.errors.push({ ...seed, reason });
      report.failed++;
      await repository.noteFailure(seed.source, seed.url.replace(/\/xml$/, '/html'), { checked_at: now(), reason });
    }
  }
  await repository.recordSync({ run_id: randomUUID(), started_at: report.checked_at, finished_at: now(),
    succeeded: report.succeeded, failed: report.failed, skipped: report.skipped, documents: report.documents });
  report.coverage = await repository.status();
  return report;
}
