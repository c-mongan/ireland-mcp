import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObjectBackend, createRepository } from '../src/store.mjs';
import { parseSource } from '../src/sources.mjs';
import { syncSources } from '../src/ingest.mjs';
import { createService } from '../src/service.mjs';
import { createWebHandler } from '../src/server.mjs';
import { guidanceUrl, guidanceHtml, actUrl, actXml } from './helpers.mjs';

async function deploy() {
  const module = await import('../../../scripts/deploy-legal.mjs').catch(error => assert.fail(`Missing deployment implementation: ${error.message}`));
  return module.deployLegal;
}
const revision = 'a'.repeat(40);
const host = 'func-ireland-mcp-test.azurewebsites.net';
const invocationTime = Date.parse('2026-10-11T12:00:00.000Z');
const lastSync = { run_id: 'completed-refresh', started_at: '2026-10-11T12:00:01.000Z', finished_at: '2026-10-11T12:00:02.000Z', succeeded: 4, failed: 0, skipped: 0, documents: 26 };
function coverage(overrides = {}) {
  return { document_count: 26, sources: { eisb: { last_success_at: lastSync.finished_at }, 'citizens-info': { last_success_at: lastSync.finished_at } }, last_sync: lastSync, ...overrides };
}
function boundaries({ failUpload = false, populated = true, nestedSite = false, statuses, staleCitation = false } = {}) {
  const commands = [], requests = [];
  let statusRead = 0;
  const sequence = statuses ?? [coverage({ last_sync: { ...lastSync, run_id: 'previous-refresh' } }), coverage({ document_count: populated ? 26 : 0, sources: populated ? coverage().sources : {} })];
  return { commands, requests,
    now: () => invocationTime,
    run: async (command, args, options) => {
      commands.push({ command, args, options });
      if (args.includes('show')) return JSON.stringify(nestedSite ? { properties: { defaultHostName: host } } : { defaultHostName: host });
      if (args.includes('deploy:zip') && failUpload) throw new Error('Upload failed');
      if (args.includes('keys')) return 'private-host-key';
      return '';
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith('/healthz')) return Response.json({ status: 'ok', sources: ['irish-legal','citizens-info'] });
      if (url.includes('/admin/functions/')) return new Response(null, { status: 202 });
      if (url.endsWith('/api/status')) return Response.json(sequence[Math.min(statusRead++, sequence.length - 1)]);
      if (url.endsWith('/api/chat')) return Response.json({ citations: [{ source_type: 'guidance', version: 'b'.repeat(64), url: 'https://www.citizensinformation.ie/en/employment/annual-leave/', stale: staleCitation }], supporting_quotes: [{ quote: 'Employees have paid annual leave rights.' }] });
      return new Response('<html><title>Irish law</title></html>', { headers: { 'content-type': 'text/html' } });
    }, wait: async () => {} };
}
test('deployment enables only the existing app, uploads a checked revision and verifies a populated chat', async () => {
  const runDeployment = await deploy();
  const boundary = boundaries();
  const result = await runDeployment({ ...boundary, resourceGroup: 'rg-ireland-mcp', functionApp: 'func-ireland-mcp-test', expectedRevision: revision, maxAttempts: 2 });
  assert.equal(result.document_count, 26);
  assert.equal(result.chat_url, `https://${host}/legal`);
  assert.deepEqual(result.refresh, lastSync, 'the receipt records the completed refresh used to verify deployment');
  const upload = boundary.commands.find(c => c.args.includes('deploy:zip'));
  assert.equal(upload.options.env.IRELAND_MCP_EXPECTED_REVISION, revision);
  assert.ok(boundary.commands.some(c => c.args.includes('LEGAL_ENABLED=true')));
  assert.ok(boundary.commands.some(c => c.args.includes('LEGAL_REVISED_ACTS_PERMISSION=false')));
  assert.ok(!boundary.commands.some(c => c.args.includes('provision') || c.args.includes('create')));
  assert.ok(!JSON.stringify(result).includes('private-host-key'));
  assert.equal(boundary.requests.find(r => r.url.includes('/admin/functions/')).options.headers['x-functions-key'], 'private-host-key');
});
test('an upload failure prevents source refresh and a success receipt', async () => {
  const runDeployment = await deploy();
  const boundary = boundaries({ failUpload: true });
  await assert.rejects(runDeployment({ ...boundary, resourceGroup: 'rg-ireland-mcp', functionApp: 'func-ireland-mcp-test', expectedRevision: revision }), /Upload failed/);
  assert.equal(boundary.requests.length, 0);
});
test('empty or incompatible coverage cannot be reported as a successful deployment', async () => {
  const runDeployment = await deploy();
  const boundary = boundaries({ populated: false });
  await assert.rejects(runDeployment({ ...boundary, resourceGroup: 'rg-ireland-mcp', functionApp: 'func-ireland-mcp-test', expectedRevision: revision, maxAttempts: 2 }), /coverage|ingestion|sources/i);
  assert.ok(!boundary.requests.some(r => r.url.endsWith('/api/chat')));
});
test('deployment accepts the nested ARM site representation as well as the flattened CLI output', async () => {
  const runDeployment = await deploy();
  const result = await runDeployment({ ...boundaries({ nestedSite: true }), resourceGroup: 'rg-ireland-mcp', functionApp: 'func-ireland-mcp-test', expectedRevision: revision });
  assert.equal(result.chat_url, `https://${host}/legal`);
});
test('deployment waits for the entire refresh after individual pages update source coverage', async () => {
  const runDeployment = await deploy();
  const previous = coverage({ last_sync: { ...lastSync, run_id: 'previous-refresh' } });
  const boundary = boundaries({ statuses: [previous, previous, coverage()] });
  let waits = 0;
  const result = await runDeployment({ ...boundary, wait: async () => { waits++; }, resourceGroup: 'rg-ireland-mcp', functionApp: 'func-ireland-mcp-test', expectedRevision: revision, maxAttempts: 2 });
  assert.equal(result.document_count, 26);
  assert.equal(waits, 1, 'per-page source timestamps do not establish refresh completion');
  assert.equal(boundary.requests.filter(r => r.url.endsWith('/api/status')).length, 3);
  assert.ok(boundary.requests.findIndex(r => r.url.endsWith('/api/status')) < boundary.requests.findIndex(r => r.url.includes('/admin/functions/')));
});
test('a pending refresh cannot reuse the previous completed run', async () => {
  const runDeployment = await deploy();
  const previous = coverage();
  const boundary = boundaries({ statuses: [previous] });
  await assert.rejects(runDeployment({ ...boundary, resourceGroup: 'rg-ireland-mcp', functionApp: 'func-ireland-mcp-test', expectedRevision: revision, maxAttempts: 2 }), /timed out/i);
  assert.ok(!boundary.requests.some(r => r.url.endsWith('/api/chat')));
});
test('a distinct run completed before invocation cannot establish refresh success', async () => {
  const runDeployment = await deploy();
  const boundary = boundaries({ statuses: [coverage({ last_sync: undefined }), coverage({ last_sync: { ...lastSync, started_at: '2020-01-01T00:00:00.000Z', finished_at: '2020-01-01T00:00:01.000Z' } })] });
  await assert.rejects(runDeployment({ ...boundary, resourceGroup: 'rg-ireland-mcp', functionApp: 'func-ireland-mcp-test', expectedRevision: revision, maxAttempts: 2 }), /timed out/i);
  assert.ok(!boundary.requests.some(r => r.url.endsWith('/api/chat')));
});
test('an older running refresh that finishes after invocation cannot establish refresh success', async () => {
  const runDeployment = await deploy();
  const boundary = boundaries({ statuses: [coverage({ last_sync: undefined }), coverage({ last_sync: { ...lastSync, started_at: '2026-10-11T11:59:00.000Z' } })] });
  await assert.rejects(runDeployment({ ...boundary, resourceGroup: 'rg-ireland-mcp', functionApp: 'func-ireland-mcp-test', expectedRevision: revision, maxAttempts: 2 }), /timed out/i);
  assert.ok(!boundary.requests.some(r => r.url.endsWith('/api/chat')));
});
test('a completed run cannot reuse historical required-source coverage', async () => {
  const runDeployment = await deploy();
  const boundary = boundaries({ statuses: [coverage({ last_sync: undefined }), coverage({ sources: { eisb: { last_success_at: '2020-01-01T00:00:00.000Z' }, 'citizens-info': { last_success_at: lastSync.finished_at } } })] });
  await assert.rejects(runDeployment({ ...boundary, resourceGroup: 'rg-ireland-mcp', functionApp: 'func-ireland-mcp-test', expectedRevision: revision, maxAttempts: 2 }), /coverage|sources/i);
  assert.ok(!boundary.requests.some(r => r.url.endsWith('/api/chat')));
});
test('stale guidance cannot pass the live chat smoke check', async () => {
  const runDeployment = await deploy();
  const boundary = boundaries({ staleCitation: true });
  await assert.rejects(runDeployment({ ...boundary, resourceGroup: 'rg-ireland-mcp', functionApp: 'func-ireland-mcp-test', expectedRevision: revision, maxAttempts: 2 }), /stale|guidance/i);
});
test('a real failed refresh with preserved versioned snapshots cannot report deployment success', async () => {
  const runDeployment = await deploy();
  const objects = new Map();
  let etag = 0;
  const repo = createRepository(new ObjectBackend({
    async get(key) { return objects.get(key) ?? null; },
    async put(key, text) { objects.set(key, { text, etag: String(++etag) }); }
  }));
  for (const [source, url, body] of [['citizens-info', guidanceUrl, guidanceHtml], ['eisb', actUrl, actXml]]) {
    await repo.commit(parseSource({ source, url, body, fetchedAt: '2020-01-01T00:00:00.000Z' }), body);
  }
  const webHandler = createWebHandler(createService(repo), { allowedOrigins: [`https://${host}`] });
  const boundary = boundaries();
  let report;
  const fetch = async (url, options) => {
    if (url.includes('/admin/functions/')) {
      report = await syncSources(repo, { seeds: [{ source: 'citizens-info', url: guidanceUrl }, { source: 'eisb', url: actUrl }] }, {
        delayMs: 0, now: () => lastSync.finished_at,
        fetch: async sourceUrl => sourceUrl.endsWith('/robots.txt') ? new Response('') : new Response('', { status: 503 })
      });
      return new Response(null, { status: 202 });
    }
    if (url.includes('/legal')) return webHandler(new Request(url.replace('/legal', ''), options));
    return boundary.fetch(url, options);
  };
  await assert.rejects(runDeployment({ ...boundary, fetch, resourceGroup: 'rg-ireland-mcp', functionApp: 'func-ireland-mcp-test', expectedRevision: revision, maxAttempts: 2 }), /Initial source refresh failed/i);
  assert.equal(report.failed, 2);
  assert.equal((await repo.status()).document_count, 4);
});
