import { htmlText } from "./text.js";

export interface ConstitutionSegment {
  /** eISB anchor id, usable as a URL fragment. Upstream anchors are not always numbered like the text. */
  anchor: string;
  /** Reference derived from the visible numbering, e.g. "12.2.1". */
  ref: string;
  text: string;
}

export interface ConstitutionArticle {
  article: string;
  anchor: string;
  heading: string;
  part: string | null;
  segments: ConstitutionSegment[];
}

export interface ParsedConstitution {
  /** Edition statement printed by eISB, e.g. "January 2020"; null when not found. */
  edition: string | null;
  articles: Map<string, ConstitutionArticle>;
}

// The opening "<" is optional: the English page has `<h5>a name="article19" ...></a>`.
const ANCHOR = /<?a\s+name="((?:article|part)[0-9A-Za-z_]+)"[^>]*>\s*<\/a>/g;
const HEADING_LINE = /^[^a-z]*[A-ZÁÉÍÓÚ][^a-z]*$/;

/** Upper-cases the letter suffix so "28a" and "28A" address the same article. */
export const articleKey = (raw: string) => raw.toUpperCase();

function clean(fragment: string): string {
  return htmlText(fragment);
}

/** Drops trailing all-capitals heading lines that belong to the next block, e.g. "THE FAMILY". */
function dropTrailingHeadings(text: string): string {
  const lines = text.split("\n");
  while (lines.length && HEADING_LINE.test(lines.at(-1)!.trim())) lines.pop();
  return lines.join("\n").trim();
}

/**
 * Parses the eISB Constitution page (English or Irish). Segments run from one anchor to the next; the
 * text after the last article stops at the closing "Dochum Glóire Dé" or the index.
 */
export function parseConstitution(html: string): ParsedConstitution {
  const edition =
    clean(html.match(/(?:time\s+of\s+printing\s+of\s+this\s+edition|eagráin\s+seo)\s+\(([^)]{3,40})\)/)?.[1] ?? "") || null;
  const first = html.search(/<?a\s+name="article1"/);
  if (first < 0) return { edition, articles: new Map() };
  const endCandidates = [html.indexOf("Dochum Gl", first), html.search(/<a\s+name="index"/)].filter((i) => i > first);
  const end = endCandidates.length ? Math.min(...endCandidates) : html.length;
  const anchors = [...html.matchAll(ANCHOR)]
    .filter((m) => m.index < end)
    .map((m) => ({ id: m[1]!, start: m.index, after: m.index + m[0].length }));

  const articles = new Map<string, ConstitutionArticle>();
  let part: string | null = null;
  let current: ConstitutionArticle | undefined;
  let section: number | null = null;
  let sub: number | null = null;
  let ref = "";

  anchors.forEach((a, i) => {
    let fragment = html.slice(a.after, i + 1 < anchors.length ? anchors[i + 1]!.start : end);
    if (a.id.startsWith("part")) {
      part = clean(fragment.split(/<h[1-6][\s>]/)[0]!).split("\n")[0] || null;
      return;
    }
    if (a.start < first) return;
    fragment = fragment.split(/<h[1-6][\s>]/)[0]!;
    const [, rawArticle, rest] = a.id.match(/^article(\d{1,2}[A-Za-z]?)(_.*)?$/) ?? [];
    if (!rawArticle) return;
    const key = articleKey(rawArticle);
    let text = clean(fragment);
    if (!rest) {
      const heading = text.match(/^(ARTICLE|AIRTEAGAL)\s+\d{1,2}[A-Z]?/i)?.[0] ?? `ARTICLE ${key}`;
      text = text.slice(text.startsWith(heading) ? heading.length : 0).trim();
      current = { article: key, anchor: a.id, heading, part, segments: [] };
      articles.set(key, current);
      section = null;
      sub = null;
      ref = key;
    }
    if (!current || current.article !== key) {
      current = articles.get(key) ?? { article: key, anchor: a.id, heading: `ARTICLE ${key}`, part, segments: [] };
      articles.set(key, current);
    }
    text = dropTrailingHeadings(text);
    if (!text) return;
    // One anchor can hold several numbered paragraphs (e.g. 12.11.2° and 3°), so each numbered line starts a segment.
    for (const block of splitNumbered(text)) {
      let body = block;
      const both = body.match(/^(\d{1,2})\s+(\d{1,2})°\s*/);
      const subOnly = body.match(/^(\d{1,2})°\s*/);
      const sectionOnly = body.match(/^(\d{1,2})\s+(?!°)(?=\S)/);
      if (both) {
        section = Number(both[1]);
        sub = Number(both[2]);
        body = body.slice(both[0].length);
      } else if (subOnly && section !== null) {
        sub = Number(subOnly[1]);
        body = body.slice(subOnly[0].length);
      } else if (sectionOnly && Number(sectionOnly[1]) === (section ?? 0) + 1) {
        section = Number(sectionOnly[1]);
        sub = null;
        body = body.slice(sectionOnly[0].length);
      }
      ref = [key, section, sub].filter((p) => p !== null).join(".");
      const last = current.segments.at(-1);
      if (last && last.ref === ref && last.anchor === a.id) last.text = `${last.text}\n${body}`;
      else current.segments.push({ anchor: a.id, ref, text: body });
    }
  });
  return { edition, articles };
}

/** Splits text before lines that start a numbered section or subsection ("2 1°", "3°"). */
function splitNumbered(text: string): string[] {
  const blocks: string[] = [];
  for (const line of text.split("\n")) {
    if (blocks.length && !/^(\d{1,2}\s+)?\d{1,2}°\s/.test(line)) blocks[blocks.length - 1] += `\n${line}`;
    else blocks.push(line);
  }
  return blocks;
}

/** Selects one article, optionally narrowed to a section ("2") or subsection ("2.1") by visible numbering. */
export function selectArticle(parsed: ParsedConstitution, article: string, subsection?: string) {
  const found = parsed.articles.get(articleKey(article));
  if (!found) return undefined;
  if (!subsection) return { ...found, segments: found.segments };
  const prefix = `${found.article}.${subsection}`;
  const segments = found.segments.filter((s) => s.ref === prefix || s.ref.startsWith(`${prefix}.`));
  return { ...found, segments };
}
