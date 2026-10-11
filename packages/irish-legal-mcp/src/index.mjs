const STOP = new Set(['a','an','the','and','or','of','to','in','for','is','are','what','how','can','i','my','do','does','on','with','it','me','please']);
export function words(value) {
  return (value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(w => !STOP.has(w));
}
export function rank(documents, query, { limit = 10, source, source_type } = {}) {
  if (typeof query !== 'string' || !query.trim() || query.length > 500) throw new Error('BAD_ARGS: query must contain 1–500 characters.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('BAD_ARGS: limit must be between 1 and 50.');
  const terms = [...new Set(words(query))];
  if (!terms.length) return [];
  const candidates = documents.filter(d => (!source || d.source_id === source) && (!source_type || d.source_type === source_type));
  const tokenized = candidates.map(d => ({ d, tokens: words(`${d.title} ${d.text}`), title: words(d.title) }));
  const average = tokenized.reduce((n, row) => n + row.tokens.length, 0) / Math.max(1, candidates.length);
  const frequency = Object.fromEntries(terms.map(term => [term, tokenized.filter(row => row.tokens.includes(term)).length]));
  return tokenized.map(({ d, tokens, title }) => {
    let score = 0;
    for (const term of terms) {
      const count = tokens.filter(t => t === term).length;
      const idf = Math.log(1 + (candidates.length - frequency[term] + 0.5) / (frequency[term] + 0.5));
      score += idf * count * 2.2 / (count + 1.2 * (0.25 + 0.75 * tokens.length / Math.max(1, average)));
      if (title.includes(term)) score += idf * 2;
    }
    return { ...d, score, snippet: d.text.slice(0, 450) };
  }).filter(d => d.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
}
