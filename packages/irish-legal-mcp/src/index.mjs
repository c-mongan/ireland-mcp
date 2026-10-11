const STOP = new Set(['a','an','the','and','or','of','to','in','for','is','are','what','how','can','i','my','do','does','on','with','it','me','please']);
const MAX_SEARCH_TERMS = 12_000;
const MAX_SEARCH_BYTES = 128 * 1024;

function* tokens(value) {
  for (const [term] of value.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
    if (!STOP.has(term)) yield term;
  }
}
export function words(value) {
  return [...tokens(value)];
}
function indexLimit(message) {
  const error = new Error(`INDEX_LIMIT: ${message}`);
  error.code = 'INDEX_LIMIT';
  return error;
}
export function buildSearchMetadata(document) {
  const counts = new Map();
  const titleTerms = new Set();
  let tokenCount = 0;
  for (const [value, isTitle] of [[document.title, true], [document.text, false]]) {
    for (const term of tokens(value)) {
      if (!counts.has(term) && counts.size === MAX_SEARCH_TERMS) {
        throw indexLimit(`Search metadata must not exceed ${MAX_SEARCH_TERMS} unique terms.`);
      }
      counts.set(term, (counts.get(term) ?? 0) + 1);
      if (isTitle) titleTerms.add(term);
      tokenCount++;
    }
  }
  const search = {
    terms: Object.fromEntries(counts),
    title_terms: [...titleTerms],
    token_count: tokenCount,
    snippet: document.text.slice(0, 450),
  };
  if (Buffer.byteLength(JSON.stringify(search), 'utf8') > MAX_SEARCH_BYTES) {
    throw indexLimit('Serialized search metadata must not exceed 128 KiB.');
  }
  return search;
}
const countTerm = (search, term) => Object.hasOwn(search.terms, term) ? search.terms[term] : 0;

export function rank(documents, query, { limit = 10, source, source_type } = {}) {
  if (typeof query !== 'string' || !query.trim() || query.length > 500) throw new Error('BAD_ARGS: query must contain 1–500 characters.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('BAD_ARGS: limit must be between 1 and 50.');
  const terms = [...new Set(words(query))];
  if (!terms.length) return [];
  const candidates = documents.filter(d => (!source || d.source_id === source) && (!source_type || d.source_type === source_type));
  const indexed = candidates.map(d => ({ d, search: d.search ?? buildSearchMetadata(d) }));
  const average = indexed.reduce((n, row) => n + row.search.token_count, 0) / Math.max(1, candidates.length);
  const frequency = Object.fromEntries(terms.map(term => [term, indexed.filter(row => countTerm(row.search, term) > 0).length]));
  return indexed.map(({ d, search }) => {
    let score = 0;
    for (const term of terms) {
      const count = countTerm(search, term);
      const idf = Math.log(1 + (candidates.length - frequency[term] + 0.5) / (frequency[term] + 0.5));
      score += idf * count * 2.2 / (count + 1.2 * (0.25 + 0.75 * search.token_count / Math.max(1, average)));
      if (search.title_terms.includes(term)) score += idf * 2;
    }
    return { ...d, score, snippet: search.snippet };
  }).filter(d => d.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
}
