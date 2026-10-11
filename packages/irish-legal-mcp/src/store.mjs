import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink, open, link } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { rank } from './index.mjs';
import { assertSourceUrl } from './policy.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const empty = () => ({ schema: 1, documents: {}, sources: {}, failed_urls: {}, updated_at: null });
function checkDate(as_of) {
  if (as_of !== undefined && (typeof as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(as_of) || !Number.isFinite(Date.parse(as_of)) || new Date(as_of).toISOString().slice(0,10) !== as_of)) throw new Error('BAD_ARGS: invalid as_of date.');
}
function historical(record, as_of) {
  return record.versions.map(v => v.document).filter(d => (d.consolidated_to ?? d.publisher_updated_at) && (d.consolidated_to ?? d.publisher_updated_at) <= as_of)
    .sort((a,b) => (b.consolidated_to ?? b.publisher_updated_at).localeCompare(a.consolidated_to ?? a.publisher_updated_at))[0];
}
function checkKey(key) {
  if (!/^(?:raw\/[a-f0-9]{64}\.txt|documents\/[a-f0-9]{64}\.json)$/.test(key)) throw new Error('Invalid snapshot identity.');
}
function checkId(id) {
  if (typeof id !== 'string' || !/^[a-z][a-z-]*:(?:\/en\/[a-z0-9/_-]+|\d{4}\/(?:act|si)\/\d+(?:\/s\d+[A-Z]*)?)$/.test(id)) throw new Error('Invalid document identity.');
}
function validateDocument(doc) {
  checkId(doc.id);
  if (!doc.id.startsWith(doc.source_id + ':') || !doc.title || typeof doc.text !== 'string' || doc.text.length < 10 ||
      !Number.isFinite(Date.parse(doc.source_fetched_at)) || !doc.attribution || !doc.licence) throw new Error('Invalid document metadata.');
  assertSourceUrl(doc.canonical_url.split('#')[0], doc.source_id);
}
function normalized(doc) {
  const copy = { ...doc };
  for (const key of ['source_fetched_at','source_checked_at','version','raw_hash','served_at','stale']) delete copy[key];
  return copy;
}

export class FileBackend {
  constructor(path) { this.path = path; }
  async readIndex() {
    try {
      const data = JSON.parse(await readFile(join(this.path, 'index.json'), 'utf8'));
      if (data.index.schema !== 1) throw new Error('Unsupported index schema.');
      return data;
    } catch (error) {
      if (error.code === 'ENOENT') return { index: empty(), revision: null };
      throw error;
    }
  }
  async writeIndex(index, expectedRevision) {
    await mkdir(this.path, { recursive: true });
    let lock;
    const lockPath = join(this.path, 'index.lock');
    try { lock = await open(lockPath, 'wx'); } catch (error) {
      if (error.code === 'EEXIST') throw new Error('CONFLICT: another writer owns the index lock.');
      throw error;
    }
    const temporary = join(this.path, `index-${randomUUID()}.tmp`);
    try {
      if ((await this.readIndex()).revision !== expectedRevision) throw new Error('CONFLICT: index changed; retry from latest revision.');
      await writeFile(temporary, JSON.stringify({ index, revision: randomUUID() }), { flag: 'wx' });
      await rename(temporary, join(this.path, 'index.json'));
    } finally {
      await lock.close();
      await unlink(lockPath);
      await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  async writeSnapshot(key, bytes) {
    checkKey(key);
    const path = join(this.path, key);
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}-${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, 'wx');
      try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
      try { await link(temporary, path); } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (await readFile(path, 'utf8') !== bytes) throw new Error('Snapshot integrity mismatch: existing immutable bytes are corrupt.');
      }
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  async readSnapshot(key) { checkKey(key); return readFile(join(this.path, key), 'utf8'); }
}


export class ObjectBackend {
  constructor(objects) { this.objects = objects; }
  async readIndex() {
    const stored = await this.objects.get('index.json');
    if (stored === null) return { index: empty(), revision: null };
    const index = JSON.parse(stored.text);
    if (index.schema !== 1) throw new Error('Unsupported index schema.');
    return { index, revision: stored.etag };
  }
  async writeIndex(index, revision) {
    return this.objects.put('index.json', JSON.stringify(index), revision === null ? { ifNoneMatch: '*' } : { ifMatch: revision });
  }
  async writeSnapshot(key, text) {
    checkKey(key);
    try { await this.objects.put(key, text, { ifNoneMatch: '*' }); }
    catch (error) {
      if (error.code !== 'ALREADY_EXISTS') throw error;
      if ((await this.objects.get(key))?.text !== text) throw new Error('Snapshot integrity mismatch: existing immutable bytes are corrupt.');
    }
  }
  async readSnapshot(key) {
    checkKey(key);
    const stored = await this.objects.get(key);
    if (!stored) throw new Error('NOT_FOUND: immutable snapshot is unavailable.');
    return stored.text;
  }
}

export function createRepository(backend) {
  const coverage = index => ({ document_count: Object.keys(index.documents).length, sources: index.sources, updated_at: index.updated_at,
    note: 'Coverage is limited to indexed source pages; no search result does not establish that a law or right does not exist.' });
  const decorate = (doc, index) => ({ ...doc, stale: Boolean(index.failed_urls[(doc.source_url ?? doc.canonical_url).split('#')[0]]) });
  return {
    async commit(documents, raw) {
      if (!Array.isArray(documents) || !documents.length || typeof raw !== 'string') throw new Error('Invalid document batch.');
      documents.forEach(validateDocument);
      const { index, revision } = await backend.readIndex();
      const raw_hash = hash(raw);
      await backend.writeSnapshot(`raw/${raw_hash}.txt`, raw);
      const versions = [];
      for (const document of documents) {
        const version = hash(JSON.stringify(normalized(document)) + raw_hash);
        const record = index.documents[document.id] ?? { versions: [], latest: null };
        const prior = record.versions.find(v => v.version === version);
        const doc = prior ? { ...prior.document, source_checked_at: document.source_checked_at ?? document.source_fetched_at }
          : { ...document, source_checked_at: document.source_checked_at ?? document.source_fetched_at, version, raw_hash };
        const snapshot = `documents/${hash(document.id + ':' + version)}.json`;
        if (!prior) await backend.writeSnapshot(snapshot, JSON.stringify(doc));
        if (!prior) record.versions.push({ version, snapshot, document: doc });
        record.latest = doc;
        index.documents[document.id] = record;
        const source = index.sources[doc.source_id] ?? {};
        index.sources[doc.source_id] = { ...source, last_success_at: doc.source_checked_at };
        delete index.failed_urls[doc.canonical_url.split('#')[0]];
        if (doc.source_url) delete index.failed_urls[doc.source_url];
        index.updated_at = doc.source_checked_at;
        versions.push(version);
      }
      await backend.writeIndex(index, revision);
      return { committed: documents.length, versions, raw_hash };
    },
    async get(id, { version, as_of } = {}) {
      checkId(id);
      checkDate(as_of);
      const { index } = await backend.readIndex();
      const record = index.documents[id];
      if (!record) throw new Error('NOT_FOUND: document is outside indexed coverage.');
      let doc = record.latest;
      if (version) {
        const entry = record.versions.find(v => v.version === version);
        if (!entry) throw new Error('NOT_FOUND: requested version is unavailable.');
        doc = JSON.parse(await backend.readSnapshot(entry.snapshot));
      }
      if (as_of) {
        const selected = historical(record, as_of);
        const date = doc.consolidated_to ?? doc.publisher_updated_at;
        if (!selected || (version && (!date || date > as_of))) throw new Error('HISTORICAL_UNAVAILABLE: no compatible dated source version is indexed.');
        if (!version) doc = selected;
      }
      return { ...decorate(doc, index), requested_as_of: as_of ?? null };
    },
    async search(query, options = {}) {
      checkDate(options.as_of);
      const { index } = await backend.readIndex();
      const records = Object.values(index.documents);
      const selected = records.map(r => options.as_of ? historical(r, options.as_of) : r.latest);
      const documents = selected.filter(Boolean).map(d => decorate(d, index));
      return { hits: rank(documents, query, options), coverage: coverage(index), historical_unavailable_count: selected.filter(d => !d).length };
    },
    async status() { return coverage((await backend.readIndex()).index); },
    async noteFailure(source, url, { checked_at, reason }) {
      const { index, revision } = await backend.readIndex();
      index.failed_urls[url] = { checked_at, reason };
      index.sources[source] = { ...index.sources[source], last_attempt_at: checked_at, last_error: reason };
      await backend.writeIndex(index, revision);
    }
  };
}
