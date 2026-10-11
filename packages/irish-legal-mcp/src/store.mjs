import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink, open, link } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { rank, buildSearchMetadata } from './index.mjs';
import { assertSourceUrl } from './policy.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const empty = () => ({ schema: 2, documents: {}, sources: {}, failed_urls: {}, updated_at: null });
function checkDate(as_of) {
  if (as_of !== undefined && (typeof as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(as_of) || !Number.isFinite(Date.parse(as_of)) || new Date(as_of).toISOString().slice(0,10) !== as_of)) throw new Error('BAD_ARGS: invalid as_of date.');
}
const referenceFields = ['id','source_id','source_type','canonical_url','source_url','source_urls','content_kind','version_type',
  'publisher_updated_at','consolidated_to','source_fetched_at','source_checked_at','version','raw_hash'];
function metadata(doc) {
  return Object.fromEntries(referenceFields.filter(key => doc[key] !== undefined).map(key => [key, doc[key]]));
}
function reference(entry) {
  return entry.document ? { version: entry.version, snapshot: entry.snapshot, metadata: metadata(entry.document) } : entry;
}
function latestReference(record) {
  if (!record.latest) return null;
  if (record.latest.metadata) return record.latest;
  const stored = record.versions.find(v => v.version === record.latest.version);
  if (!stored) throw new Error('Invalid index: latest snapshot is missing.');
  return { ...reference(stored), metadata: metadata(record.latest) };
}
function compareReferences(a, b) {
  const date = d => d.consolidated_to ?? d.publisher_updated_at;
  const observed = d => Math.max(Date.parse(d.source_checked_at ?? d.source_fetched_at), Date.parse(d.source_fetched_at));
  return date(b.metadata).localeCompare(date(a.metadata)) || observed(b.metadata) - observed(a.metadata) || b.version.localeCompare(a.version);
}
function historical(record, as_of) {
  const latest = latestReference(record);
  const candidates = record.versions.map(v => v.version === latest?.version ? latest : reference(v)).filter(v => {
    const d = v.metadata;
    return (d.consolidated_to ?? d.publisher_updated_at) && (d.consolidated_to ?? d.publisher_updated_at) <= as_of;
  }).sort(compareReferences);
  const selected = candidates[0];
  if (!selected) return null;
  const date = selected.metadata.consolidated_to ?? selected.metadata.publisher_updated_at;
  return { ...selected, ambiguous: candidates.filter(v => (v.metadata.consolidated_to ?? v.metadata.publisher_updated_at) === date).length > 1 };
}
async function compact(index, backend) {
  for (const record of Object.values(index.documents)) {
    record.latest = latestReference(record);
    record.versions = await mapBounded(record.versions, async stored => {
      const entry = reference(stored);
      if (!entry.metadata.search) {
        const doc = stored.document ?? JSON.parse(await backend.readSnapshot(entry.snapshot));
        entry.metadata = { ...entry.metadata, search: buildSearchMetadata(doc) };
      }
      return entry;
    });
    record.latest.metadata = { ...record.latest.metadata,
      search: record.versions.find(v => v.version === record.latest.version).metadata.search };
  }
  index.schema = 2;
}
const sourceUrls = doc => [...new Set([doc.source_url ?? doc.canonical_url, ...(doc.source_urls ?? [])].map(url => url.split('#')[0].replace(/\/xml$/, '/html')))];
async function mapBounded(items, mapper) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(8, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await mapper(items[i]); }
  }));
  return results;
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
  for (const key of ['source_fetched_at','source_checked_at','source_urls','version','raw_hash','served_at','stale']) delete copy[key];
  return copy;
}

export class FileBackend {
  constructor(path) { this.path = path; }
  async readIndex() {
    try {
      const data = JSON.parse(await readFile(join(this.path, 'index.json'), 'utf8'));
      if (![1, 2].includes(data.index.schema)) throw new Error('Unsupported index schema.');
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
      if (error.code === 'EEXIST') throw new Error('CONFLICT: another writer owns the index lock.', { cause: error });
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
        if (await readFile(path, 'utf8') !== bytes) throw new Error('Snapshot integrity mismatch: existing immutable bytes are corrupt.', { cause: error });
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
    if (![1, 2].includes(index.schema)) throw new Error('Unsupported index schema.');
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
      if ((await this.objects.get(key))?.text !== text) throw new Error('Snapshot integrity mismatch: existing immutable bytes are corrupt.', { cause: error });
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
  const coverage = index => ({ document_count: Object.values(index.documents).filter(r => !r.retired_to).length, sources: index.sources, updated_at: index.updated_at, last_sync: index.last_sync ?? null,
    note: 'Coverage is limited to indexed source pages; no search result does not establish that a law or right does not exist.' });
  const decorate = (doc, index, record) => ({ ...doc, stale: sourceUrls({ ...doc,
    source_urls: [...(doc.source_urls ?? []), ...(latestReference(record)?.metadata.source_urls ?? [])] }).some(url => Boolean(index.failed_urls[url])) });
  const hydrate = async entry => {
    const publicMetadata = { ...entry.metadata }; delete publicMetadata.search;
    const doc = { ...JSON.parse(await backend.readSnapshot(entry.snapshot)), ...publicMetadata };
    if (entry.ambiguous) doc.warnings = [...(doc.warnings ?? []), 'Multiple stored texts share this publisher date; the newest retrieved snapshot is selected. Historical wording is not verified.'];
    return doc;
  };
  return {
    async commit(documents, raw) {
      if (!Array.isArray(documents) || !documents.length || typeof raw !== 'string') throw new Error('Invalid document batch.');
      documents.forEach(validateDocument);
      const { index, revision } = await backend.readIndex();
      // Reject missing provisions before publishing any replacement for an existing complete instrument.
      for (const whole of documents.filter(d => d.source_type === 'legislation' && d.content_kind === 'full_text')) {
        if (!index.documents[whole.id]) continue;
        const incoming = new Set(documents.map(d => d.id));
        const missing = Object.entries(index.documents).filter(([id, record]) => !record.retired_to && id.startsWith(whole.id + '/s') && !incoming.has(id));
        if (missing.length) throw new Error(`INCOMPLETE: refresh omits ${missing.length} previously indexed provisions; prior instrument retained.`);
      }
      await compact(index, backend);
      const raw_hash = hash(raw);
      await backend.writeSnapshot(`raw/${raw_hash}.txt`, raw);
      const versions = [];
      for (const document of documents) {
        const version = hash(JSON.stringify(normalized(document)) + raw_hash);
        const record = index.documents[document.id] ?? { versions: [], latest: null };
        const prior = record.versions.find(v => v.version === version);
        const doc = prior ? { ...await hydrate(prior), source_checked_at: document.source_checked_at ?? document.source_fetched_at }
          : { ...document, source_checked_at: document.source_checked_at ?? document.source_fetched_at, version, raw_hash };
        doc.source_urls = [...new Set([...(record.latest?.metadata.source_urls ?? []), ...sourceUrls(document)])];
        // Resolve every earlier destination associated with this redirect seed, including successive moves.
        const aliases = sourceUrls(document).filter(url => url !== doc.canonical_url && url !== doc.source_url);
        if (doc.source_id === 'citizens-info' && aliases.length) for (const [oldId, oldRecord] of Object.entries(index.documents)) {
          const old = oldRecord.latest.metadata;
          if (oldId !== doc.id && old.source_id === doc.source_id && old.canonical_url !== doc.canonical_url && sourceUrls(old).some(url => aliases.includes(url))) {
            oldRecord.retired_to = doc.id;
            doc.source_urls = [...new Set([...doc.source_urls, ...sourceUrls(old)])];
          }
        }
        const snapshot = `documents/${hash(document.id + ':' + version)}.json`;
        const search = prior?.metadata.search ?? buildSearchMetadata(doc);
        if (!prior) await backend.writeSnapshot(snapshot, JSON.stringify(doc));
        if (!prior) record.versions.push({ version, snapshot, metadata: { ...metadata(doc), search } });
        else prior.metadata = { ...prior.metadata, source_checked_at: doc.source_checked_at };
        record.latest = { version, snapshot, metadata: { ...metadata(doc), search } };
        delete record.retired_to;
        index.documents[document.id] = record;
        const source = index.sources[doc.source_id] ?? {};
        index.sources[doc.source_id] = { ...source, last_attempt_at: doc.source_checked_at, last_success_at: doc.source_checked_at };
        delete index.sources[doc.source_id].last_error;
        for (const url of sourceUrls(doc)) delete index.failed_urls[url];
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
      let record = index.documents[id];
      if (!record) throw new Error('NOT_FOUND: document is outside indexed coverage.');
      if (!version && !as_of) {
        const visited = new Set([id]);
        while (record.retired_to) {
          if (visited.has(record.retired_to) || !index.documents[record.retired_to]) throw new Error('Invalid redirect alias in index.');
          visited.add(record.retired_to);
          record = index.documents[record.retired_to];
        }
      }
      let entry = latestReference(record);
      if (version) {
        const stored = record.versions.find(v => v.version === version);
        if (!stored) throw new Error('NOT_FOUND: requested version is unavailable.');
        entry = reference(stored);
      }
      if (as_of) {
        const selected = historical(record, as_of);
        const date = entry.metadata.consolidated_to ?? entry.metadata.publisher_updated_at;
        if (!selected || (version && (!date || date > as_of))) throw new Error('HISTORICAL_UNAVAILABLE: no compatible dated source version is indexed.');
        if (!version) entry = selected;
      }
      return { ...decorate(await hydrate(entry), index, record), requested_as_of: as_of ?? null };
    },
    async search(query, options = {}) {
      checkDate(options.as_of);
      const { index } = await backend.readIndex();
      let selected;
      if (options.as_of) {
        const families = new Map();
        for (const [id, record] of Object.entries(index.documents)) {
          let target = id;
          const visited = new Set();
          while (index.documents[target]?.retired_to) {
            if (visited.has(target)) throw new Error('Invalid redirect alias in index.');
            visited.add(target);
            target = index.documents[target].retired_to;
          }
          const family = families.get(target) ?? [];
          family.push({ record, entry: historical(record, options.as_of) });
          families.set(target, family);
        }
        selected = [...families.values()].map(family => {
          const candidates = family.filter(d => d.entry).sort((a,b) => compareReferences(a.entry, b.entry));
          if (!candidates.length) return { entry: null };
          const chosen = candidates[0];
          const date = entry => entry.metadata.consolidated_to ?? entry.metadata.publisher_updated_at;
          const ambiguous = chosen.entry.ambiguous || candidates.filter(d => date(d.entry) === date(chosen.entry)).length > 1;
          return { ...chosen, entry: { ...chosen.entry, ambiguous } };
        });
      } else selected = Object.values(index.documents).filter(r => !r.retired_to).map(record => ({ record, entry: latestReference(record) }));
      const candidates = await mapBounded(selected.filter(d => d.entry), async ({ entry, record }) => {
        // Older indexes remain readable until the next successful commit migrates their lexical metadata.
        const search = entry.metadata.search ?? buildSearchMetadata(await hydrate(entry));
        return { ...entry.metadata, search, entry, record };
      });
      const hits = await mapBounded(rank(candidates, query, options), async ({ entry, record, score, snippet }) => ({
        ...decorate(await hydrate(entry), index, record), score, snippet
      }));
      return { hits, coverage: coverage(index), historical_unavailable_count: selected.filter(d => !d.entry).length };
    },
    async status() { return coverage((await backend.readIndex()).index); },
    async recordSync(completion) {
      if (typeof completion.run_id !== 'string' || !/^[a-zA-Z0-9-]{8,64}$/.test(completion.run_id) ||
          !Number.isFinite(Date.parse(completion.started_at)) || !Number.isFinite(Date.parse(completion.finished_at)) ||
          Date.parse(completion.finished_at) < Date.parse(completion.started_at) ||
          !['succeeded','failed','skipped','documents'].every(key => Number.isInteger(completion[key]) && completion[key] >= 0)) throw new Error('Invalid source sync completion.');
      const { index, revision } = await backend.readIndex();
      index.last_sync = { ...completion };
      await backend.writeIndex(index, revision);
    },
    async noteFailure(source, url, { checked_at, reason }) {
      const { index, revision } = await backend.readIndex();
      index.failed_urls[url] = { checked_at, reason };
      index.sources[source] = { ...index.sources[source], last_attempt_at: checked_at, last_error: reason };
      await backend.writeIndex(index, revision);
    }
  };
}
