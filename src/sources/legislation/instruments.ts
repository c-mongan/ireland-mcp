import { htmlText } from "./text.js";

export const EISB_HOST = "www.irishstatutebook.ie";
export const siUri = (year: number, number: number, language: "en" | "ga" = "en") => `https://${EISB_HOST}/eli/${year}/si/${number}/made/${language}/html`;

export interface SiListing {
  /** Number used by the instrument's ELI. */
  number: number;
  /** Number printed in the listing when it differs (older years list some instruments unnumbered or reuse numbers). */
  listed_number?: string | null;
  title: string;
  /** "ga" for instruments published only in Irish. */
  language: "en" | "ga";
}

/**
 * Rows of an eISB year listing (/eli/{year}/si/): `<td class="align-center">N</td><td><a href="/{y}/en/si/0001.html">Title</a>`.
 * The link's number is canonical; it matches the ELI even where the printed number is blank or repeated.
 */
export function parseSiListing(html: string): SiListing[] {
  const rows = html.matchAll(/<tr>\s*<td class="align-center">\s*(\d*)\s*<\/td>\s*<td>\s*<a href="\/\d{4}\/(en|ga)\/si\/(\d{1,5})\.html">([\s\S]*?)<\/a>/g);
  return [...rows]
    .map((m) => {
      const number = Number(m[3]);
      const listed = m[1] ?? "";
      const language = m[2] === "ga" ? ("ga" as const) : ("en" as const);
      return { number, ...(listed === String(number) ? {} : { listed_number: listed || null }), title: htmlText(m[4]!), language };
    })
    .filter((r, _i, all) => {
      if (!(r.number > 0) || !r.title || /^missing title$/i.test(r.title)) return false;
      // Some years list an Irish placeholder row beside the English row for the same instrument.
      return r.language === "en" || !all.some((o) => o.number === r.number && o.language === "en");
    });
}

export interface SiDocument {
  title: string;
  made: string | null;
  explanatory_note: string | null;
  changes: string[];
  based_on: string[];
  transposes: string[];
  text: string;
}

const ELI_META = /<meta\s+about="[^"]*"\s+property="eli:([a-z_]+)"\s+(content|resource)="([^"]*)"/gi;

/**
 * Keeps only ELI references on the eISB or data.europa.eu hosts, upgraded to https. They are returned as
 * links for the caller and are never fetched by this server.
 */
export function eliLink(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.username || url.password || url.port || url.search) return null;
  if (url.hostname === EISB_HOST || url.hostname === "irishstatutebook.ie") {
    return /^\/eli\/\d{4}\/(?:act|si)\/\d+(?:\/section\/[0-9A-Za-z]+)?\/(?:enacted|made)$/.test(url.pathname) ? `https://${EISB_HOST}${url.pathname}` : null;
  }
  if (url.hostname === "data.europa.eu") return /^\/eli\/[a-z_]+\/\d{4}\/\d+\/oj$/.test(url.pathname) ? `http://data.europa.eu${url.pathname}` : null;
  return null;
}

/** Parses a made-SI page (/eli/{y}/si/{n}/made/en/html): ELI metadata plus the body text. */
export function parseSiPage(html: string): SiDocument | undefined {
  const meta = new Map<string, string[]>();
  for (const m of html.matchAll(ELI_META)) {
    const key = m[1]!.toLowerCase();
    meta.set(key, [...(meta.get(key) ?? []), m[3]!]);
  }
  const title = htmlText(meta.get("title")?.[0] ?? html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "").replace(/^S\.I\. No\. \d+\/\d{4} - /, "");
  const start = html.search(/<div class="act-content" id="act">/);
  if (!title || start < 0) return undefined;
  const endMarker = html.indexOf("<!--End Content-->", start);
  const body = html.slice(start, endMarker > 0 ? endMarker : undefined);
  const links = (key: string) => [...new Set((meta.get(key) ?? []).map(eliLink).filter((u): u is string => u !== null))];
  const made = meta.get("date_document")?.[0];
  return {
    title,
    made: made && /^\d{4}-\d{2}-\d{2}$/.test(made) ? made : null,
    explanatory_note: htmlText(meta.get("description")?.[0] ?? "") || null,
    changes: links("changes"),
    based_on: links("based_on"),
    transposes: links("transposes"),
    text: htmlText(body)
  };
}
