export const SOURCES = Object.freeze({
  'citizens-info': { publisher: 'Citizens Information Board', type: 'guidance', host: 'www.citizensinformation.ie',
    path: /^\/en\/(?!search|about|contact)[a-z0-9/_-]+\/?$/, licence: 'CC BY 4.0 (third-party material excluded)',
    attribution: 'Contains information from the Citizens Information Board, licensed under CC BY 4.0.',
    terms: 'https://www.citizensinformation.ie/en/about/reuse-psi/', storage_allowed: true },
  eisb: { publisher: 'Irish Statute Book / Office of the Attorney General', type: 'legislation', host: 'www.irishstatutebook.ie',
    path: /^\/eli\/\d{4}\/(?:act|si)\/\d+\/(?:section\/[0-9A-Za-z]+\/)?(?:enacted|made)\/en\/(?:xml|html)$/,
    licence: 'Oireachtas (Open Data) PSI Licence (incorporates CC BY 4.0)',
    attribution: 'Contains Oireachtas information licensed under the Oireachtas (Open Data) PSI Licence. Source: Irish Statute Book, Office of the Attorney General.',
    terms: 'https://www.irishstatutebook.ie/eli/open-data.html', storage_allowed: true },
  'legislation-effects': { publisher: 'Irish Statute Book / Office of the Attorney General', type: 'effects', host: 'www.irishstatutebook.ie',
    path: /^\/eli\/isbc\/\d{4}_\d+\.html$/, licence: 'Oireachtas (Open Data) PSI Licence (incorporates CC BY 4.0)',
    attribution: 'Contains Oireachtas information licensed under the Oireachtas (Open Data) PSI Licence. Source: Irish Statute Book Legislation Directory, Office of the Attorney General.',
    terms: 'https://www.irishstatutebook.ie/eli/open-data.html', storage_allowed: true },
  'revised-acts': { publisher: 'Law Reform Commission', type: 'legislation', host: 'revisedacts.lawreform.ie',
    path: /^\/eli\/\d{4}\/act\/\d+\/revised\/en\/html(?:\/\d{4}-\d{2}-\d{2})?$/,
    licence: 'Source-specific permission required for indexing and redistribution', attribution: 'Law Reform Commission Revised Acts.',
    terms: 'https://www.lawreform.ie/revised-acts/', storage_allowed: false }
});

export function sourcePolicy(source, permissions = {}) {
  if (!Object.hasOwn(SOURCES, source)) throw new Error(`Unsupported or blocked source: ${source}`);
  const policy = SOURCES[source];
  return { ...policy, storage_allowed: policy.storage_allowed || permissions[source] === true };
}

export function assertSourceUrl(value, source) {
  const policy = sourcePolicy(source);
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid source URL.'); }
  if (url.protocol !== 'https:' || url.hostname !== policy.host || url.port || url.username || url.password || url.search ||
      !policy.path.test(url.pathname) || /%|\.\./.test(url.pathname)) throw new Error('URL is outside the permitted HTTPS source path.');
  url.hash = '';
  return url;
}
