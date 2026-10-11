import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

const execute = promisify(execFile);
const command = async (file, args, options = {}) => (await execute(file, args, { ...options, timeout: 12 * 60000, maxBuffer: 2 * 1024 * 1024 })).stdout.trim();

/** Existing-app rollout only. Credentials remain in the Azure CLI/HTTPS boundaries. */
export async function deployLegal({ resourceGroup, functionApp, expectedRevision, run = command, fetch: fetcher = globalThis.fetch, wait = pause, maxAttempts = 36 }) {
  if (!/^[A-Za-z0-9._()-]{1,90}$/.test(resourceGroup ?? '') || !/^[a-z0-9-]{2,60}$/.test(functionApp ?? '') || !/^[a-f0-9]{40}$/.test(expectedRevision ?? '')) throw new Error('An explicit existing resource group, Function App and checked Git revision are required.');
  const target = ['--resource-group', resourceGroup, '--name', functionApp];
  const host = await run('az', ['functionapp','show', ...target, '--query','properties.defaultHostName','--output','tsv']);
  if (!/^[a-z0-9-]+\.azurewebsites\.net$/.test(host)) throw new Error('Unexpected Function App hostname.');
  const base = `https://${host}`;
  await run('az', ['functionapp','config','appsettings','set', ...target, '--settings',
    'LEGAL_ENABLED=true','LEGAL_SYNC_ENABLED=true','LEGAL_REVISED_ACTS_PERMISSION=false',
    `LEGAL_ALLOWED_ORIGINS=${base},https://mcp.irishopendata.ie,https://mcp.irishopendata.com`, '--output','none']);
  await run('npm', ['run','deploy:zip'], { env: { ...process.env, RESOURCE_GROUP: resourceGroup, FUNCTION_APP: functionApp, IRELAND_MCP_EXPECTED_REVISION: expectedRevision } });
  const get = async (path, options = {}) => fetcher(base + path, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) });
  const poll = async check => {
    let lastError;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try { const result = await check(); if (result) return result; } catch (error) { lastError = error; }
      if (attempt + 1 < maxAttempts) await wait(5000);
    }
    throw new Error('Deployment smoke check timed out: live health or required source coverage is unavailable.', { cause: lastError });
  };
  await poll(async () => {
    const response = await get('/healthz');
    if (!response.ok) return false;
    const health = await response.json();
    return health.status === 'ok' && ['irish-legal','citizens-info'].every(id => health.sources?.includes(id));
  });
  const key = await run('az', ['functionapp','keys','list', ...target, '--query','masterKey','--output','tsv']);
  if (!key) throw new Error('Function host key is unavailable for initial source refresh.');
  const refresh = await get('/admin/functions/legalSourceSync', { method: 'POST', headers: { 'content-type': 'application/json', 'x-functions-key': key }, body: JSON.stringify({ input: null }) });
  if (!refresh.ok) throw new Error(`Initial source refresh was refused: HTTP ${refresh.status}.`);
  const coverage = await poll(async () => {
    const response = await get('/legal/api/status');
    if (!response.ok) return false;
    const status = await response.json();
    return status.document_count > 0 && ['eisb','citizens-info'].every(id => status.sources?.[id]?.last_success_at) ? status : false;
  });
  const page = await get('/legal');
  if (!page.ok || !page.headers.get('content-type')?.includes('text/html')) throw new Error('Legal chat page is unavailable.');
  const response = await get('/legal/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'annual leave', mode: 'citizen' }) });
  if (!response.ok) throw new Error(`Legal chat smoke check failed: HTTP ${response.status}.`);
  const answer = await response.json();
  if (!answer.citations?.some(c => c.source_type === 'guidance' && /^[a-f0-9]{64}$/.test(c.version ?? '') && c.url?.startsWith('https://www.citizensinformation.ie/')) || !answer.supporting_quotes?.some(q => q.quote?.length > 20)) throw new Error('Legal chat did not return versioned guidance and supporting passages.');
  return { revision: expectedRevision, chat_url: `${base}/legal`, mcp_url: `${base}/mcp`, document_count: coverage.document_count, sources: Object.keys(coverage.sources) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await deployLegal({ resourceGroup: process.env.RESOURCE_GROUP, functionApp: process.env.FUNCTION_APP, expectedRevision: process.env.IRELAND_MCP_EXPECTED_REVISION }), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
