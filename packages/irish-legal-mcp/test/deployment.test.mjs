import { test } from 'node:test';
import assert from 'node:assert/strict';

async function deploy() {
  const module = await import('../../../scripts/deploy-legal.mjs').catch(error => assert.fail(`Missing deployment implementation: ${error.message}`));
  return module.deployLegal;
}
const revision = 'a'.repeat(40);
const host = 'func-ireland-mcp-test.azurewebsites.net';
function boundaries({ failUpload = false, populated = true } = {}) {
  const commands = [], requests = [];
  return { commands, requests,
    run: async (command, args, options) => {
      commands.push({ command, args, options });
      if (args.includes('show')) return host;
      if (args.includes('deploy:zip') && failUpload) throw new Error('Upload failed');
      if (args.includes('keys')) return 'private-host-key';
      return '';
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith('/healthz')) return Response.json({ status: 'ok', sources: ['irish-legal','citizens-info'] });
      if (url.includes('/admin/functions/')) return new Response(null, { status: 202 });
      if (url.endsWith('/api/status')) return Response.json({ document_count: populated ? 26 : 0, sources: populated ? { eisb: { last_success_at: '2026-10-11' }, 'citizens-info': { last_success_at: '2026-10-11' } } : {} });
      if (url.endsWith('/api/chat')) return Response.json({ citations: [{ source_type: 'guidance', version: 'b'.repeat(64), url: 'https://www.citizensinformation.ie/en/employment/annual-leave/' }], supporting_quotes: [{ quote: 'Employees have paid annual leave rights.' }] });
      return new Response('<html><title>Irish law</title></html>', { headers: { 'content-type': 'text/html' } });
    }, wait: async () => {} };
}
test('deployment enables only the existing app, uploads a checked revision and verifies a populated chat', async () => {
  const runDeployment = await deploy();
  const boundary = boundaries();
  const result = await runDeployment({ ...boundary, resourceGroup: 'rg-ireland-mcp', functionApp: 'func-ireland-mcp-test', expectedRevision: revision, maxAttempts: 2 });
  assert.equal(result.document_count, 26);
  assert.equal(result.chat_url, `https://${host}/legal`);
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
