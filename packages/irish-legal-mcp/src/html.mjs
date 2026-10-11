const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const SKIP = new Set(['script', 'style', 'nav', 'footer', 'header', 'noscript', 'form']);
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
export function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (full, value) => {
    if (!value.startsWith('#')) return ENTITIES[value.toLowerCase()] ?? full;
    const n = value[1].toLowerCase() === 'x' ? parseInt(value.slice(2), 16) : Number(value.slice(1));
    return n >= 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : full;
  });
}

/** Small non-executing HTML/XML tree reader. No external entities or resource loading. */
export function tree(markup, { strict = false } = {}) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const tokens = markup.match(/<!--[\s\S]*?-->|<![^>]*>|<\?[^>]*\?>|<\/?[^>]+>|[^<]+/g) ?? [];
  if (strict && tokens.join('') !== markup) throw new Error('Incomplete XML markup.');
  for (const token of tokens) {
    if (/^<!|^<\?/.test(token)) continue;
    if (/^<\//.test(token)) {
      const tag = token.match(/^<\/\s*([^\s>]+)/)?.[1]?.toLowerCase();
      if (strict && (stack.length === 1 || stack.at(-1).tag !== tag)) throw new Error('Mismatched XML closing element.');
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === tag) { stack.length = i; break; }
    } else if (token.startsWith('<')) {
      const tag = token.match(/^<\s*([^\s/>]+)/)?.[1]?.toLowerCase();
      if (!tag) continue;
      const attrs = {};
      for (const m of token.slice(tag.length + 1).matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) attrs[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4]);
      const node = { tag, attrs, children: [] };
      stack.at(-1).children.push(node);
      if ((strict || !VOID.has(tag)) && !/\/\s*>$/.test(token)) stack.push(node);
    } else stack.at(-1).children.push({ tag: '#text', value: decode(token), attrs: {}, children: [] });
  }
  if (strict && (stack.length !== 1 || root.children.filter(n => n.tag !== '#text').length !== 1 || root.children.some(n => n.tag === '#text' && n.value.trim()))) throw new Error('Unclosed or incomplete XML document.');
  return root;
}
export function findAll(node, predicate) {
  const result = [];
  const walk = n => { if (predicate(n)) result.push(n); for (const child of n.children ?? []) walk(child); };
  walk(node);
  return result;
}
export const find = (node, predicate) => findAll(node, predicate)[0];
export function readable(node, baseUrl, links = []) {
  if (node.tag === '#text') return node.value;
  const punctuation = { odq: '“', cdq: '”', osq: '‘', csq: '’', emdash: '—', endash: '–' };
  if (punctuation[node.tag]) return punctuation[node.tag];
  if (SKIP.has(node.tag) || node.attrs?.['aria-hidden'] === 'true') return '';
  const inner = node.children.map(n => readable(n, baseUrl, links)).join('');
  if (node.tag === 'a' && node.attrs.href) {
    try {
      const url = new URL(node.attrs.href, baseUrl);
      if (['https:', 'http:'].includes(url.protocol)) {
        links.push({ title: inner.trim(), url: url.href });
        return `[${inner.trim()}](${url.href})`;
      }
    } catch { /* retain visible text for malformed links */ }
  }
  if (node.tag === 'br') return '\n';
  if (node.tag === 'td' || node.tag === 'th') return `${inner.trim()} | `;
  if (['p', 'div', 'sect', 'section', 'li', 'tr', 'table', 'h1', 'h2', 'h3', 'h4', 'title', 'number', 'fn'].includes(node.tag)) return `\n${inner}\n`;
  return inner;
}
export function text(node, baseUrl, links = []) {
  return readable(node, baseUrl, links).replace(/[\t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
export function humanDate(value) {
  const m = value?.match(/\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i);
  if (!m) return null;
  const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const iso = `${m[3]}-${String(months.indexOf(m[2].toLowerCase()) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return Number.isFinite(Date.parse(iso)) && new Date(iso).toISOString().slice(0,10) === iso ? iso : null;
}
