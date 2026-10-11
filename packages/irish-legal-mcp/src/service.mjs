import { SOURCES, sourcePolicy } from './policy.mjs';
import { describeEvidence } from './evidence.mjs';

const string = { type: 'string', minLength: 1, maxLength: 500 };
const query = { ...string, description: 'Words to find in the indexed Irish sources.' };
const id = { ...string, description: 'Exact document identity returned by search.' };
const limit = { type: 'integer', minimum: 1, maximum: 50 };
const as_of = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Requested publisher version date; unavailable historical versions are reported explicitly.' };
const version = { type: 'string', pattern: '^[a-f0-9]{64}$', description: 'Exact immutable version returned by a previous lookup.' };
function tool(name, description, properties, required = []) {
  return { name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } };
}
export const TOOLS = [
  tool('irish_legal_catalogue', 'Irish source coverage, licences, ingestion permissions and refresh status.', {}),
  tool('irish_legal_search', 'Search indexed guidance, enacted legislation, permitted consolidations and amendment records; returns versioned citations.',
    { query, limit, source: { type: 'string', enum: Object.keys(SOURCES) }, source_type: { type: 'string', enum: ['guidance','legislation','effects'] } }, ['query']),
  tool('irish_legal_fetch', 'Retrieve an exact document or stored version with its source dates and legal-currentness warnings.', { id, version, as_of }, ['id']),
  tool('irish_legal_get_provision', 'Retrieve one Act section. Select enacted or revised explicitly; missing revised text never falls back silently.',
    { year: { type: 'integer', minimum: 1922, maximum: 2100 }, number: { type: 'integer', minimum: 1, maximum: 500 },
      section: { type: 'string', pattern: '^[0-9]{1,4}[A-Z]{0,2}$' }, version_type: { type: 'string', enum: ['enacted','revised'] }, version, as_of }, ['year','number','section','version_type']),
  tool('irish_legal_get_changes', 'Retrieve stored amendment/commencement evidence for an Act; this does not certify that all effects were checked.',
    { year: { type: 'integer', minimum: 1922, maximum: 2100 }, number: { type: 'integer', minimum: 1, maximum: 500 }, as_of }, ['year','number']),
  tool('irish_legal_research', 'Combine relevant legal provisions and citizen guidance with exact citations, coverage and unresolved-currentness warnings.', { query, limit, as_of }, ['query']),
  tool('citizens_info_search', 'Search indexed Citizens Information explanatory guidance.', { query, limit }, ['query']),
  tool('citizens_info_get_article', 'Retrieve a Citizens Information article and its dated source metadata.', { id, version, as_of }, ['id'])
];

export function validateArguments(definition, args) {
  const schema = definition.inputSchema;
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('BAD_ARGS: expected an argument object.');
  for (const key of schema.required) if (!(key in args)) throw new Error(`BAD_ARGS: ${key} is required.`);
  for (const [key, value] of Object.entries(args)) {
    const rule = schema.properties[key];
    if (!rule) throw new Error(`BAD_ARGS: unsupported argument ${key}.`);
    if (rule.type === 'string' && (typeof value !== 'string' || (rule.minLength && value.trim().length < rule.minLength) ||
        (rule.maxLength && value.length > rule.maxLength) || (rule.pattern && !new RegExp(rule.pattern).test(value)))) throw new Error(`BAD_ARGS: invalid ${key}.`);
    if (rule.type === 'integer' && (!Number.isInteger(value) || value < rule.minimum || value > rule.maximum)) throw new Error(`BAD_ARGS: invalid ${key}.`);
    if (rule.enum && !rule.enum.includes(value)) throw new Error(`BAD_ARGS: invalid ${key}.`);
  }
}

export function createService(repository, { now = () => new Date().toISOString() } = {}) {
  const evidence = (selected, options = {}) => {
    const doc = describeEvidence(selected, { now: now(), as_of: options.as_of });
    if (doc.text.length > 20000) return { ...doc, text: doc.text.slice(0,20000), text_truncated: true, warnings: [...doc.warnings, 'Text truncated for transport; consult the canonical source for the complete provision.'] };
    return { ...doc, text_truncated: false };
  };
  const fetch = async (id, options = {}) => evidence(await repository.get(id, options), options);
  return {
    tools: TOOLS,
    async call(name, args = {}) {
      const definition = TOOLS.find(t => t.name === name);
      if (!definition) throw new Error('UNKNOWN_TOOL: unsupported operation.');
      validateArguments(definition, args);
      if (name === 'irish_legal_catalogue') return { sources: Object.keys(SOURCES).map(id => ({ id, ...sourcePolicy(id) })), coverage: await repository.status() };
      if (name === 'irish_legal_search' || name === 'citizens_info_search') {
        const result = await repository.search(args.query, { limit: args.limit ?? 10, source: name === 'citizens_info_search' ? 'citizens-info' : args.source, source_type: args.source_type });
        return { ...result, hits: result.hits.map(doc => {
          const evidence = describeEvidence(doc, { now: now() });
          const hit = { ...evidence }; delete hit.text;
          return hit;
        }) };
      }
      if (name === 'irish_legal_fetch' || name === 'citizens_info_get_article') {
        if (name === 'citizens_info_get_article' && !args.id.startsWith('citizens-info:')) throw new Error('BAD_ARGS: a Citizens Information identity is required.');
        return fetch(args.id, args);
      }
      if (name === 'irish_legal_get_provision') return fetch(`${args.version_type === 'revised' ? 'revised-acts' : 'eisb'}:${args.year}/act/${args.number}/s${args.section}`, args);
      if (name === 'irish_legal_get_changes') return fetch(`legislation-effects:${args.year}/act/${args.number}`, args);
      const result = await repository.search(args.query, { limit: args.limit ?? 10, as_of: args.as_of });
      const documents = [];
      const warnings = result.historical_unavailable_count ? [`${result.historical_unavailable_count} indexed documents have no compatible publisher-dated version for this historical request.`] : [];
      for (const hit of result.hits) {
        const doc = evidence(hit, { as_of: args.as_of });
        documents.push(doc);
        warnings.push(...doc.warnings);
      }
      return { documents, coverage: result.coverage, warnings: [...new Set(warnings)], current_law_verified: false, requested_as_of: args.as_of ?? null };
    }
  };
}
