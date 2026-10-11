import { assertSourceUrl, sourcePolicy } from './policy.mjs';
import { tree, find, findAll, text, humanDate } from './html.mjs';

function base(source, url, fetchedAt) {
  const p = sourcePolicy(source);
  if (!Number.isFinite(Date.parse(fetchedAt))) throw new Error('A valid source fetch timestamp is required.');
  return { source_id: source, source_type: p.type, publisher: p.publisher, jurisdiction: 'IE', licence: p.licence,
    attribution: p.attribution, source_url: url.href.replace(/\/xml$/, '/html'), canonical_url: url.href.replace(/\/xml$/, '/html'), publisher_updated_at: null,
    source_fetched_at: fetchedAt, source_checked_at: fetchedAt, legal_effective_date: null, consolidated_to: null,
    publisher_currency_statement: null, instrument: null, section: null, warnings: [], annotations: [], links: [], effects: [] };
}
function bodyNode(root) {
  return find(root, n => n.tag === 'main') ?? find(root, n => n.tag === 'article') ??
    find(root, n => /^(?:content|main-content|maincontent)$/.test(n.attrs.id ?? ''));
}
function identity(url) {
  const m = url.pathname.match(/\/eli\/(\d{4})\/(act|si)\/(\d+)\//);
  if (!m) throw new Error('Missing statute identity in source URL.');
  return { year: Number(m[1]), type: m[2], number: Number(m[3]) };
}

export function parseSource({ source, url: input, body, fetchedAt }) {
  const url = assertSourceUrl(input, source);
  if (typeof body !== 'string' || body.length > 4 * 1024 * 1024) throw new Error('Source body is missing or too large.');
  const root = tree(body, { strict: source === 'eisb' });
  const common = base(source, url, fetchedAt);
  if (source === 'citizens-info') {
    const article = bodyNode(root);
    const title = text(find(article ?? root, n => n.tag === 'h1') ?? { tag: '#root', children: [] }, url);
    if (!article || !title || !find(article, n => ['p', 'li', 'table'].includes(n.tag)) || text(article, url).length < title.length + 15)
      throw new Error('No substantive Citizens Information article body.');
    const links = [];
    const content = text(article, url, links);
    const edited = content.match(/Page (?:edited|updated):?\s*([^\n]+)/i)?.[1];
    return [{ ...common, id: `${source}:${url.pathname}`, title, text: content, links,
      publisher_updated_at: humanDate(edited), content_kind: 'article', version_type: 'guidance' }];
  }
  if (source === 'eisb') {
    const act = find(root, n => n.tag === 'act' || n.tag === 'statutoryinstrument');
    const metadata = act && find(act, n => n.tag === 'metadata');
    const titleNode = metadata && find(metadata, n => n.tag === 'title');
    const body = act && find(act, n => n.tag === 'body');
    if (!act || !titleNode || !body) throw new Error('Expected statute XML with Act metadata and body.');
    const instrument = identity(url);
    const key = `${instrument.year}/${instrument.type}/${instrument.number}`;
    const title = text(titleNode, url);
    const version_type = instrument.type === 'si' ? 'made' : 'enacted';
    const sections = findAll(body, n => n.tag === 'sect' && /^SEC[0-9A-Z]+$/i.test(n.attrs.id ?? ''));
    const whole = { ...common, instrument, id: `${source}:${key}`, title, text: text(body, url), content_kind: 'full_text', version_type };
    if (whole.text.length < 15) throw new Error('Statute XML has no substantive body.');
    return [whole, ...sections.map(node => {
      const section = node.attrs.id.slice(3);
      const heading = text(find(node, n => n.tag === 'title') ?? node, url).split('\n')[0];
      return { ...common, instrument, id: `${source}:${key}/s${section}`, section, title: `${title}, section ${section}: ${heading}`,
        text: text(node, url), content_kind: 'provision', version_type,
        canonical_url: `${url.origin}/eli/${key}/section/${section}/${version_type}/en/html` };
    })];
  }
  if (source === 'revised-acts') {
    const article = bodyNode(root) ?? find(root, n => n.tag === 'body');
    const titleNode = article && find(article, n => n.tag === 'h1');
    if (!article || !titleNode) throw new Error('No substantive Revised Act body or title.');
    const instrument = identity(url);
    const key = `${instrument.year}/act/${instrument.number}`;
    const title = text(titleNode, url);
    const content = text(article, url);
    const consolidated_to = humanDate(content.match(/Updated to\s*([^\n]+)/i)?.[1]);
    const publisher_currency_statement = content.match(/Changes to legislation:[^\n]+/i)?.[0] ?? null;
    const warnings = publisher_currency_statement && /not (?:yet )?(?:been )?(?:implemented|incorporated)/i.test(publisher_currency_statement) ? [publisher_currency_statement] : [];
    const annotations = findAll(article, n => /annotation/i.test(n.attrs.class ?? '')).map(n => text(n, url));
    const metadata = { ...common, instrument, consolidated_to, publisher_currency_statement, warnings, annotations, version_type: 'revised' };
    if (content.length < title.length + 15) throw new Error('No substantive Revised Act text.');
    const sections = findAll(article, n => /^(?:sec|section)[_-]?\d+[A-Z]*$/i.test(n.attrs.id ?? ''));
    return [{ ...metadata, id: `${source}:${key}`, title, text: content, content_kind: 'full_text' }, ...sections.map(n => {
      const section = n.attrs.id.replace(/^(?:section|sec)[_-]?/i, '');
      return { ...metadata, id: `${source}:${key}/s${section}`, section, title: `${title}, section ${section}`, text: text(n, url),
        canonical_url: `${url.href}#${n.attrs.id}`, content_kind: 'provision' };
    })];
  }
  const article = bodyNode(root) ?? find(root, n => n.tag === 'body');
  if (!article || !find(article, n => n.tag === 'table')) throw new Error('No legal effects table in source body.');
  const effects = findAll(article, n => n.tag === 'table').flatMap(table => {
    const headers = findAll(table, n => n.tag === 'th').map(n => text(n, url).toLowerCase().replace(/\s*\|\s*$/, '').trim());
    const commencementColumn = headers.findIndex(h => /^(?:date of )?commencement(?: date)?$/.test(h));
    const sectionColumn = headers.findIndex(h => /^(?:section|provision)$/.test(h));
    return findAll(table, n => n.tag === 'tr').filter(n => find(n, c => c.tag === 'td')).map(row => {
    const cells = findAll(row, n => n.tag === 'td').map(n => text(n, url).replace(/\s*\|\s*$/, '').trim());
    const all = cells.join(' | ');
    const section = all.match(/\b(?:Section|s\.)\s*(\d+[A-Z]*)\b/i)?.[1] ?? cells[sectionColumn]?.match(/^(\d+[A-Z]*)$/)?.[1] ?? null;
    const commencementText = cells[commencementColumn] ?? '';
    const notCommenced = /not commenced|uncommenced/i.test(commencementText);
    const commenced_on = notCommenced ? null : humanDate(commencementText);
    return { section, description: all, commencement: notCommenced ? 'not_commenced' : commenced_on ? 'dated' : 'unknown', commenced_on, evidence_url: url.href };
    });
  });
  const m = url.pathname.match(/(\d{4})_(\d+)\.html$/);
  return [{ ...common, id: `${source}:${m[1]}/act/${m[2]}`, title: text(find(article, n => n.tag === 'h1') ?? article, url).split('\n')[0],
    text: text(article, url), instrument: { year: Number(m[1]), type: 'act', number: Number(m[2]) },
    publisher_updated_at: humanDate(text(article, url).match(/Updated to\s*([^\n]+)/i)?.[1]), content_kind: 'effects', version_type: 'effects', effects }];
}
