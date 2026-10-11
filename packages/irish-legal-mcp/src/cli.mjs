import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { FileBackend, createRepository } from './store.mjs';
import { createService } from './service.mjs';
import { runStdio } from './stdio.mjs';
import { createHttpServer } from './server.mjs';
import { syncSources } from './ingest.mjs';
import { createAzureGenerator } from './azure-openai.mjs';

const HELP = `Irish legal and citizen-information MCP

Commands: help, status, sync, mcp (stdio), serve (HTTP and chat)
Options: --store PATH, --manifest PATH, --port NUMBER, --host HOST

node packages/irish-legal-mcp/src/cli.mjs sync
node packages/irish-legal-mcp/src/cli.mjs serve --port 4173
node packages/irish-legal-mcp/src/cli.mjs mcp

Sources are indexed only by sync. Public tools are read-only.
Default seeds cover annual leave and working time; extend the manifest for other topics.
`;
export async function runCli(args, { stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, env = process.env, fetch: fetcher } = {}) {
  try {
    const command = args[0] ?? 'help';
    if (!['help','status','sync','mcp','serve'].includes(command)) throw new Error('Unknown command. Use help.');
    const options = {};
    for (let i = 1; i < args.length; i += 2) {
      if (!['--store','--manifest','--port','--host'].includes(args[i]) || !args[i+1]) throw new Error('Invalid command option. Use help.');
      options[args[i].slice(2)] = args[i+1];
    }
    const port = Number(options.port ?? env.LEGAL_PORT ?? 4173);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port.');
    if (command === 'help') { stdout.write(HELP); return 0; }
    const repository = createRepository(new FileBackend(resolve(options.store ?? env.LEGAL_STORE_DIR ?? '.irish-legal-cache')));
    if (command === 'status') { stdout.write(JSON.stringify(await repository.status()) + '\n'); return 0; }
    if (command === 'sync') {
      const manifest = JSON.parse(await readFile(options.manifest ?? new URL('../seeds.json', import.meta.url), 'utf8'));
      const report = await syncSources(repository, manifest, { ...(fetcher ? { fetch: fetcher } : {}), permissions: { 'revised-acts': env.LEGAL_REVISED_ACTS_PERMISSION === 'true' } });
      stdout.write(JSON.stringify(report, null, 2) + '\n');
      return report.failed ? 1 : 0;
    }
    const service = createService(repository);
    if (command === 'mcp') { await runStdio(service, stdin, stdout); return 0; }
    const generate = env.AZURE_OPENAI_ENDPOINT && env.AZURE_OPENAI_DEPLOYMENT ? createAzureGenerator({ endpoint: env.AZURE_OPENAI_ENDPOINT,
      deployment: env.AZURE_OPENAI_DEPLOYMENT, apiKey: env.AZURE_OPENAI_API_KEY }) : undefined;
    const server = createHttpServer(service, { bearerToken: env.LEGAL_BEARER_TOKEN,
      allowedOrigins: (env.LEGAL_ALLOWED_ORIGINS ?? '').split(',').map(v => v.trim()).filter(Boolean), generate });
    server.listen(port, options.host ?? '127.0.0.1');
    await once(server, 'listening');
    stderr.write(`Irish legal chat and MCP listening at http://${options.host ?? '127.0.0.1'}:${port}\n`);
    return 0;
  } catch (error) { stderr.write(`${error.message}\n`); return 2; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await runCli(process.argv.slice(2));
