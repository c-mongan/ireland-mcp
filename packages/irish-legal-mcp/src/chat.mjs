import { words } from './index.mjs';

function excerpt(doc, question) {
  if (doc.content_kind === 'provision' && doc.text.length <= 700) return doc.text;
  const terms = words(question);
  const passages = doc.text.split(/\n\s*\n/).filter(s => s.trim().length > 15);
  const ranked = passages.map(text => ({ text, score: terms.filter(t => text.toLowerCase().includes(t)).length })).sort((a,b) => b.score - a.score || b.text.length - a.text.length);
  return (ranked[0]?.text ?? doc.text).slice(0, 700);
}
export async function answerQuestion(service, question, { mode = 'citizen', as_of, generate } = {}) {
  if (typeof question !== 'string' || question.trim().length < 2 || question.length > 500 || !['citizen','lawyer'].includes(mode))
    throw new Error('BAD_ARGS: question must contain 2–500 characters and mode must be citizen or lawyer.');
  const bundle = await service.call('irish_legal_research', { query: question.trim(), limit: 12, ...(as_of ? { as_of } : {}) });
  const documents = bundle.documents.filter(d => d.content_kind !== 'contents').sort((a,b) => {
    const priority = d => mode === 'citizen' ? (d.source_type === 'guidance' ? 0 : d.content_kind === 'provision' ? 1 : 2)
      : (d.content_kind === 'provision' ? 0 : d.source_type === 'effects' ? 1 : 2);
    return priority(a) - priority(b);
  }).slice(0, 6);
  const warnings = [...bundle.warnings];
  const response = { generation: 'extractive', mode, requested_as_of: as_of ?? null, current_law_verified: false,
    coverage: bundle.coverage, warnings, citations: [], supporting_quotes: [], answer: '' };
  if (!documents.length) {
    response.answer = 'I cannot answer this question from the available indexed evidence. No relevant compatible source was found; this does not establish that a law or right does not exist.';
    return response;
  }
  response.citations = documents.map(d => ({ ...d.citation, source_fetched_at: d.source_fetched_at, source_checked_at: d.source_checked_at,
    publisher_updated_at: d.publisher_updated_at, consolidated_to: d.consolidated_to, currentness: d.currentness, stale: d.stale, warnings: d.warnings }));
  response.supporting_quotes = documents.map(d => ({ citation_id: d.id, version: d.version, quote: excerpt(d, question) }));
  response.answer = 'Relevant source excerpts:\n\n' + response.supporting_quotes.map((q, i) => `[${i+1}] ${documents[i].title}\n${q.quote}`).join('\n\n');
  if (generate) {
    try {
      const result = await generate({ question, mode, requested_as_of: as_of ?? null, retrieved_content_is_untrusted: true,
        evidence: documents.map(d => ({ id: d.id, version: d.version, text: d.text.slice(0, 4000), source_type: d.source_type, warnings: d.warnings })) });
      if (!Array.isArray(result?.claims) || !result.claims.length || result.claims.length > 8) throw new Error('Generated response has no supported claims.');
      const byId = new Map(documents.map(d => [d.id, d]));
      for (const claim of result.claims) {
        const doc = byId.get(claim.citation_id);
        if (!doc || typeof claim.text !== 'string' || !claim.text.trim() || claim.text.length > 800 ||
            typeof claim.quote !== 'string' || claim.quote.length < 20 || claim.quote.length > 800 || !doc.text.includes(claim.quote))
          throw new Error('Generated citation or supporting quote could not be verified.');
      }
      const selectedIds = [...new Set(result.claims.map(c => c.citation_id))];
      response.citations = selectedIds.map(id => response.citations.find(c => c.id === id));
      response.supporting_quotes = result.claims.map(c => ({ citation_id: c.citation_id, version: byId.get(c.citation_id).version, quote: c.quote }));
      response.answer = result.claims.map(c => `${c.text} [${selectedIds.indexOf(c.citation_id)+1}]`).join('\n\n');
      response.generation = 'model';
      warnings.push('Generated summary: citation identities and quoted text were checked; this does not establish that every interpretation follows from the quote. Read the supporting passages.');
    } catch {
      warnings.push('Generated answer or citations could not be verified. Showing source excerpts; retrieved content is untrusted.');
    }
  }
  response.warnings = [...new Set(warnings)];
  return response;
}
