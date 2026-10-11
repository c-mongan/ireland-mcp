import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { feature } from './helpers.mjs';

test('runtime assets are included in root package and Azure build copying', async () => {
  const pkg = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8'));
  assert.ok(pkg.files.includes('dist/packages/irish-legal-mcp'));
  const copier = await readFile(new URL('../../../scripts/copy-assets.mjs', import.meta.url), 'utf8');
  assert.match(copier, /irish-legal-mcp/);
  assert.ok(pkg.scripts['legal:check']);
});
test('core object storage preserves versions and uses conditional index updates', async () => {
  const ObjectBackend = await feature('store', 'ObjectBackend');
  const objects = new Map();
  let sequence = 0;
  const backend = new ObjectBackend({
    get: async key => objects.get(key) ?? null,
    put: async (key, text, condition) => {
      const current = objects.get(key);
      if ((condition.ifMatch && current?.etag !== condition.ifMatch) || (condition.ifNoneMatch && current)) {
        const error = new Error('CONFLICT'); error.code = key === 'index.json' ? 'CONFLICT' : 'ALREADY_EXISTS'; throw error;
      }
      objects.set(key, { text, etag: String(++sequence) });
    }
  });
  const initial = await backend.readIndex();
  await backend.writeIndex(initial.index, initial.revision);
  await assert.rejects(backend.writeIndex(initial.index, initial.revision), /CONFLICT/);
  assert.ok((await backend.readIndex()).revision);
});
test('test helpers never register application tests when imported by other suites', async () => {
  const files = (await readdir(new URL('.', import.meta.url))).filter(file => file.endsWith('.test.mjs'));
  for (const file of files) {
    const body = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(body, /^import .* from ['"]\.\/.*\.test\.mjs['"]/m);
  }
});
