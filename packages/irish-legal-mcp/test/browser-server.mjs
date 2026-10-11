// Offline browser fixture server. Never used by the product or source sync.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileBackend, createRepository } from '../src/store.mjs';
import { parseSource } from '../src/sources.mjs';
import { createService } from '../src/service.mjs';
import { createHttpServer } from '../src/server.mjs';
import { actXml, actUrl, guidanceHtml, guidanceUrl, fetchedAt } from './helpers.mjs';

const path = await mkdtemp(join(tmpdir(), 'legal-browser-fixture-'));
const repository = createRepository(new FileBackend(path));
await repository.commit(parseSource({ source: 'citizens-info', url: guidanceUrl, body: guidanceHtml, fetchedAt }), guidanceHtml);
await repository.commit(parseSource({ source: 'eisb', url: actUrl, body: actXml, fetchedAt }), actXml);
const server = createHttpServer(createService(repository));
server.listen(4174, '127.0.0.1');
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close(async () => { await rm(path, { recursive: true, force: true }); process.exit(0); }));
