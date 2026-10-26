import { z } from "zod";
import { DAY } from "../../gateway/context.js";
import { bound, envelope, type SourceInfo } from "../../gateway/envelope.js";
import { ToolError } from "../../gateway/errors.js";
import { defineTool, type FetchedDocument, type SearchHit, type SourceModule, type ToolContext } from "../../gateway/module.js";
import { parseConstitution, selectArticle, type ConstitutionSegment } from "./constitution.js";
import { parseActEffects } from "./effects.js";
import { parseSiListing, parseSiPage, siUri } from "./instruments.js";
import { toText } from "./text.js";
import { legislationCard } from "./card.js";

// Approach adapted from ie-eli-mcp (Apache-2.0): address Acts by their ELI URI and read the eISB XML rendering.
// Licence verified 26 Oct 2026 at https://www.irishstatutebook.ie/eli/open-data.html.
export const legislationInfo: SourceInfo = {
  id: "legislation",
  name: "Irish Statute Book (eISB) via ELI",
  licence: "Oireachtas (Open Data) PSI Licence (incorporates CC BY 4.0)",
  attribution:
    "Contains Oireachtas information licensed under the Oireachtas (Open Data) PSI Licence. Source: electronic Irish Statute Book (eISB), Office of the Attorney General.",
  homepage: "https://www.irishstatutebook.ie"
};

export const LICENCE_TERMS = "https://www.irishstatutebook.ie/eli/open-data.html";
export const NOT_LEGAL_ADVICE = "Not legal advice. Check the official source, and get professional advice before relying on it.";
export const ENACTED_NOT_AMENDED =
  "Enacted or made text is not amended text: later Acts and SIs may have changed or repealed it. Use legislation_get_act_effects to check amendments and commencement.";

export const EISB = "https://www.irishstatutebook.ie";
const TTL = DAY;
const WEEK = 7 * DAY;
const FIRST_YEAR = 1922;

export const actUri = (year: number, number: number) => `${EISB}/eli/${year}/act/${number}/enacted/en/html`;
export const sectionUri = (year: number, number: number, section: string) =>
  `${EISB}/eli/${year}/act/${number}/section/${section}/enacted/en/html`;

export { toText };

export interface Act {
  year: number;
  number: number;
  title: string;
  enacted: string | null;
  url: string;
  xml: string;
}

function checkYear(year: number, now: Date, kind = "Acts") {
  if (year < FIRST_YEAR || year > now.getUTCFullYear()) {
    throw new ToolError("BAD_ARGS", `The eISB covers ${kind} from ${FIRST_YEAR} to ${now.getUTCFullYear()}.`);
  }
}

/** Rejects HTML pages that lack an expected marker, so soft-error pages are never cached. */
const expectMarker = (marker: RegExp, what: string) => (html: string) => {
  if (!marker.test(html)) throw new ToolError("UPSTREAM_DOWN", `The Irish Statute Book returned an unexpected ${what} page.`);
};

/** Replaces the generic upstream 404 message with one naming the requested document. */
const notFound = (message: string, hint: string) => (error: unknown): never => {
  if (error instanceof ToolError && error.code === "NOT_FOUND") throw new ToolError("NOT_FOUND", message, { hint });
  throw error;
};

/** Cuts text to max characters, reporting the full length. */
function clip(text: string, max: number) {
  return { text: text.length > max ? `${text.slice(0, max)}…` : text, text_length: text.length, truncated: text.length > max };
}

export async function loadAct(ctx: ToolContext, year: number, number: number) {
  checkYear(year, ctx.now());
  const xmlUrl = `${EISB}/eli/${year}/act/${number}/enacted/en/xml`;
  const result = await ctx.cachedText(xmlUrl, TTL, { label: "Irish Statute Book" });
  const xml = result.value;
  const title = xml.match(/<metadata>[\s\S]*?<title>([\s\S]*?)<\/title>/)?.[1];
  if (!xml.includes("<act") || !title) throw new ToolError("NOT_FOUND", `No Act ${number} of ${year} in the Irish Statute Book.`);
  const d = xml.match(/<dateofenactment>(\d{4})(\d{2})(\d{2})<\/dateofenactment>/);
  const act: Act = {
    year,
    number,
    title: titleCase(toText(title)),
    enacted: d ? `${d[1]}-${d[2]}-${d[3]}` : null,
    url: actUri(year, number),
    xml
  };
  return { act, cached: result.cached, stale: result.stale };
}

const SMALL = new Set(["and", "of", "the", "for", "to", "in", "on", "or", "a", "an", "by", "with"]);
function titleCase(s: string): string {
  if (s !== s.toUpperCase()) return s;
  return s
    .toLowerCase()
    .split(" ")
    .map((w, i) => (i > 0 && SMALL.has(w) ? w : w.replace(/(^|[(-])([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase())))
    .join(" ");
}

export interface Section {
  id: string;
  number: string;
  heading: string;
}

export function listSections(xml: string): Section[] {
  const body = xml.slice(xml.indexOf("<body>"));
  return [...body.matchAll(/<sect id="SEC([^"]+)">\s*<number>([^<]*)<\/number>\s*(?:<title>([\s\S]*?)<\/title>)?/g)].map((m) => ({
    id: m[1]!,
    number: m[2]!.replace(/\.$/, "").trim(),
    heading: toText(m[3] ?? "")
  }));
}

export function sectionText(xml: string, id: string): string | undefined {
  const body = xml.slice(xml.indexOf("<body>"));
  const start = body.indexOf(`<sect id="SEC${id}">`);
  if (start < 0) return undefined;
  const rest = body.slice(start);
  const next = rest.slice(1).search(/<sect id=|<\/part>|<\/body>|<chapter /);
  const fragment = next < 0 ? rest : rest.slice(0, next + 1);
  return toText(fragment.replace(/<title>[\s\S]*?<\/title>/, "").replace(/<number>[\s\S]*?<\/number>/, ""));
}

export interface ActListing {
  number: number;
  title: string;
  url: string;
}

export async function listActs(ctx: ToolContext, year: number) {
  checkYear(year, ctx.now());
  const url = `${EISB}/eli/${year}/act/`;
  const result = await ctx.cachedText(url, TTL, { label: "Irish Statute Book" });
  const acts: ActListing[] = [...result.value.matchAll(/<tr>\s*<td class="align-center">\s*(\d+)\s*<\/td>\s*<td>\s*<a href="[^"]*">([^<]+)<\/a>/g)].map((m) => ({
    number: Number(m[1]),
    title: toText(m[2]!),
    url: actUri(year, Number(m[1]))
  }));
  return { url, acts, cached: result.cached, stale: result.stale };
}

const year = z.number().int().min(FIRST_YEAR).max(2100).describe("Year the Act was enacted, e.g. 2018.");
const number = z.number().int().min(1).max(200).describe("Act number within the year, e.g. 7 for the Data Protection Act 2018.");

const listActsTool = defineTool({
  name: "legislation_list_acts",
  title: "List Acts for a year",
  description: "Lists the Acts of the Oireachtas enacted in a given year from the Irish Statute Book, optionally filtered by title words.",
  inputSchema: {
    year,
    query: z.string().max(100).optional().describe("Words that must all appear in the title, e.g. 'data protection'."),
    limit: z.number().int().min(1).max(500).default(50)
  },
  handler: async ({ year, query, limit }, ctx) => {
    const r = await listActs(ctx, year);
    const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const matching = r.acts.filter((a) => words.every((w) => a.title.toLowerCase().includes(w)));
    const page = bound(matching, limit);
    return envelope(legislationInfo, {
      data: { year, total: matching.length, acts: page.items },
      url: r.url,
      cached: r.cached,
      stale: r.stale,
      truncated: page.truncated
    });
  }
});

const getActTool = defineTool({
  name: "legislation_get_act",
  title: "Act details and contents",
  description:
    "Title, enactment date, ELI link and table of sections for an Act (as enacted, not as amended). Use legislation_get_section for section text.",
  inputSchema: { year, number, limit: z.number().int().min(1).max(500).default(100).describe("Maximum sections to list.") },
  handler: async ({ year, number, limit }, ctx) => {
    const { act, cached, stale } = await loadAct(ctx, year, number);
    const sections = bound(listSections(act.xml), limit);
    return envelope(legislationInfo, {
      data: { title: act.title, year, number, enacted: act.enacted, eli: act.url, sections: sections.items, note: "Text is the Act as enacted. Use legislation_get_act_effects for amendments and commencement." },
      url: act.url,
      cached,
      stale,
      truncated: sections.truncated
    });
  }
});

const getSectionTool = defineTool({
  name: "legislation_get_section",
  title: "Section text",
  description: "Plain text of one section of an Act as enacted, e.g. section 2 of Act 7 of 2018.",
  inputSchema: { year, number, section: z.string().regex(/^[0-9]{1,4}[A-Z]{0,2}$/).describe("Section number, e.g. '2' or '19A'.") },
  handler: async ({ year, number, section }, ctx) => {
    const { act, cached, stale } = await loadAct(ctx, year, number);
    const text = sectionText(act.xml, section);
    if (text === undefined) throw new ToolError("NOT_FOUND", `${act.title} has no section ${section}.`);
    const heading = listSections(act.xml).find((s) => s.id === section)?.heading ?? null;
    const url = sectionUri(year, number, section);
    return envelope(legislationInfo, { data: { act: act.title, section, heading, text, eli: url }, url, cached, stale });
  }
});

const siNumber = z.number().int().min(1).max(5000).describe("Statutory Instrument number within the year, e.g. 1 for S.I. No. 1 of 2024.");
const maxChars = z.number().int().min(500).max(30000).default(6000).describe("Maximum characters of text to return (500-30000).");

const constitutionTool = defineTool({
  name: "legislation_get_constitution_article",
  title: "Constitution article",
  description:
    "Text of an Article of Bunreacht na hÉireann (the Constitution of Ireland) from the Irish Statute Book, in English or Irish, optionally narrowed to a section or subsection such as '2' or '2.1'. Each paragraph carries its reference (e.g. 12.2.1) and an eISB anchor link.",
  inputSchema: {
    article: z.string().regex(/^\d{1,2}[A-Za-z]?$/).describe("Article number, e.g. '40' or '42A'."),
    subsection: z
      .string()
      .regex(/^\d{1,2}(\.\d{1,2})?$/)
      .optional()
      .describe("Section, or section.subsection, by the printed numbering, e.g. '3' or '3.3' for Article 40.3.3°."),
    lang: z.enum(["en", "ga"]).default("en").describe("en (English) or ga (Irish). The Irish text prevails in a conflict (Article 25.5.4°)."),
    max_chars: maxChars
  },
  example: { article: "12", subsection: "2" },
  handler: async ({ article, subsection, lang, max_chars }, ctx) => {
    const page = `${EISB}/eli/cons/${lang}/html`;
    const result = await ctx.cachedText(page, WEEK, {
      label: "Irish Statute Book",
      validate: expectMarker(/<?a\s+name="article1"/, "Constitution")
    });
    const parsed = parseConstitution(result.value);
    const found = selectArticle(parsed, article, subsection);
    if (!found) throw new ToolError("NOT_FOUND", `The Constitution has no Article ${article}.`, { hint: "Articles run from 1 to 50, plus 28A and 42A." });
    if (!found.segments.length) {
      throw new ToolError("NOT_FOUND", `Article ${found.article} has no section ${subsection}.`, { hint: "Omit subsection to see the whole Article and its references." });
    }
    let budget = max_chars;
    const paragraphs: Array<ConstitutionSegment & { url: string }> = [];
    let truncated = false;
    for (const segment of found.segments) {
      if (budget <= 0) {
        truncated = true;
        break;
      }
      const piece = clip(segment.text, budget);
      truncated ||= piece.truncated;
      budget -= piece.text.length;
      paragraphs.push({ ...segment, text: piece.text, url: `${page}#${segment.anchor}` });
    }
    const url = `${page}#${found.segments[0]!.anchor}`;
    return envelope(legislationInfo, {
      data: {
        article: found.article,
        heading: found.heading,
        part: found.part,
        language: lang,
        subsection: subsection ?? null,
        edition: parsed.edition,
        paragraphs,
        total_paragraphs: found.segments.length,
        text_truncated: truncated,
        licence_terms: LICENCE_TERMS,
        warnings: [
          NOT_LEGAL_ADVICE,
          `This is the eISB edition of the Constitution${parsed.edition ? ` (printed ${parsed.edition})` : ""}; an amendment made after that edition would not appear here.`,
          "In a conflict between the Irish and English texts, the Irish text prevails (Article 25.5.4°).",
          "References follow the printed numbering; eISB anchors are link targets and do not always match it."
        ]
      },
      url,
      cached: result.cached,
      stale: result.stale,
      truncated
    });
  }
});

async function loadSiListing(ctx: ToolContext, year: number) {
  checkYear(year, ctx.now(), "Statutory Instruments");
  const url = `${EISB}/eli/${year}/si/`;
  const result = await ctx.cachedText(url, TTL, { label: "Irish Statute Book", validate: expectMarker(/<tbody/, "SI listing") });
  return { url, items: parseSiListing(result.value), cached: result.cached, stale: result.stale };
}


const listSisTool = defineTool({
  name: "legislation_list_sis",
  title: "List Statutory Instruments for a year",
  description:
    "Lists Statutory Instruments (regulations, orders, rules) made in a given year from the Irish Statute Book, optionally filtered by title words, e.g. 'commencement' or 'data protection'.",
  inputSchema: {
    year: z.number().int().min(FIRST_YEAR).max(2100).describe("Year the SI was made, e.g. 2024."),
    query: z.string().max(100).optional().describe("Words that must all appear in the title."),
    limit: z.number().int().min(1).max(500).default(50)
  },
  example: { year: 2024, query: "commencement", limit: 10 },
  handler: async ({ year, query, limit }, ctx) => {
    const r = await loadSiListing(ctx, year);
    const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const matching = r.items.filter((i) => words.every((w) => i.title.toLowerCase().includes(w)));
    const page = bound(matching.map((i) => ({ ...i, url: siUri(year, i.number, i.language) })), limit);
    return envelope(legislationInfo, {
      data: { year, total: matching.length, sis: page.items, licence_terms: LICENCE_TERMS, warnings: [NOT_LEGAL_ADVICE] },
      url: r.url,
      cached: r.cached,
      stale: r.stale,
      truncated: page.truncated
    });
  }
});

const getSiTool = defineTool({
  name: "legislation_get_si",
  title: "Statutory Instrument text",
  description:
    "Title, date made, explanatory note, parent-Act powers (based_on), instruments it changes, EU acts it transposes (ELI links) and the text of one Statutory Instrument as made.",
  inputSchema: {
    year: z.number().int().min(FIRST_YEAR).max(2100).describe("Year the SI was made, e.g. 2024."),
    number: siNumber,
    max_chars: maxChars
  },
  example: { year: 2024, number: 1, max_chars: 2000 },
  handler: async ({ year, number, max_chars }, ctx) => {
    checkYear(year, ctx.now(), "Statutory Instruments");
    const url = siUri(year, number);
    const result = await ctx
      .cachedText(url, WEEK, { label: "Irish Statute Book", validate: expectMarker(/class="act-content"/, "Statutory Instrument") })
      .catch(notFound(`No S.I. No. ${number} of ${year} in the Irish Statute Book.`, "Use legislation_list_sis to find SI numbers for a year."));
    const doc = parseSiPage(result.value);
    if (!doc) throw new ToolError("NOT_FOUND", `No S.I. No. ${number} of ${year} in the Irish Statute Book.`);
    const body = clip(doc.text, max_chars);
    return envelope(legislationInfo, {
      data: {
        title: doc.title,
        citation: `S.I. No. ${number} of ${year}`,
        year,
        number,
        made: doc.made,
        explanatory_note: doc.explanatory_note,
        based_on: doc.based_on,
        changes: doc.changes,
        transposes: doc.transposes,
        text: body.text,
        text_length: body.text_length,
        text_truncated: body.truncated,
        eli: url,
        licence_terms: LICENCE_TERMS,
        warnings: [NOT_LEGAL_ADVICE, ENACTED_NOT_AMENDED, "The explanatory note is not part of the instrument and is not a legal interpretation."]
      },
      url,
      cached: result.cached,
      stale: result.stale,
      truncated: body.truncated
    });
  }
});

const SECTION_ITEM = /^\s*(\d+)([A-Z]{0,2})(?:\([0-9A-Za-z]+\))*(?:\s*[-–]\s*(\d+)([A-Z]{0,2})(?:\([0-9A-Za-z]+\))*)?\s*(,|and\b)?/;

/**
 * Best-effort match of a section in eISB provision text such as "S. 60(3A) inserted", "Ss. 71, 72",
 * "Ss. 2-6" or "Part 5 ch. 2 (ss. 62-64A)". Schedules ("Sch.") are not sections.
 */
export function mentionsSection(text: string, section: string): boolean {
  if (/^whole act$/i.test(text.trim())) return true;
  const [, wantNumber, wantSuffix = ""] = section.toUpperCase().match(/^(\d+)([A-Z]{0,2})$/) ?? [];
  if (!wantNumber) return false;
  const want = Number(wantNumber);
  for (const prefix of text.matchAll(/\bss?\.\s*/gi)) {
    let rest = text.slice(prefix.index + prefix[0].length);
    for (let guard = 0; guard < 50; guard += 1) {
      const item = rest.match(SECTION_ITEM);
      if (!item) break;
      const [from, fromSuffix = "", to, toSuffix = ""] = [Number(item[1]), item[2]?.toUpperCase(), item[3], item[4]?.toUpperCase()];
      if (to === undefined) {
        if (from === want && fromSuffix === wantSuffix) return true;
      } else {
        const upper = Number(to);
        // A lettered section such as 64A sits after 64, so "62-64A" includes 64 and 64A.
        const inside = (want > from || (want === from && wantSuffix >= fromSuffix)) && (want < upper || (want === upper && wantSuffix <= toSuffix));
        if (inside) return true;
      }
      if (!item[5]) break;
      rest = rest.slice(item[0].length);
    }
  }
  return false;
}

const actEffectsTool = defineTool({
  name: "legislation_get_act_effects",
  title: "Act amendments and commencement",
  description:
    "From the eISB Legislation Directory: when each section of an Act commenced, how later Acts and SIs have amended, repealed or applied it, and SIs made under it. Use it before relying on as-enacted text from legislation_get_act or legislation_get_section.",
  inputSchema: {
    year,
    number,
    section: z.string().regex(/^[0-9]{1,4}[A-Z]{0,2}$/).optional().describe("Only rows that mention this section (best-effort text match), e.g. '60'."),
    limit: z.number().int().min(1).max(500).default(50).describe("Maximum rows per table.")
  },
  example: { year: 2018, number: 7, limit: 10 },
  handler: async ({ year, number, section, limit }, ctx) => {
    checkYear(year, ctx.now());
    const url = `${EISB}/eli/isbc/${year}_${number}.html`;
    const result = await ctx
      .cachedText(url, TTL, { label: "Irish Statute Book", validate: expectMarker(/id="(?:effects|commencement)"/, "Legislation Directory") })
      .catch(notFound(`No Legislation Directory entry for Act ${number} of ${year}.`, "Use legislation_list_acts to check the Act number."));
    const effects = parseActEffects(result.value);
    if (!effects) throw new ToolError("NOT_FOUND", `No Legislation Directory entry for Act ${number} of ${year}.`);
    const keep = <T>(rows: T[], text: (row: T) => string) => (section ? rows.filter((r) => mentionsSection(text(r), section)) : rows);
    const commencement = keep(effects.commencement, (r) => r.provision);
    const amendments = keep(effects.effects, (r) => r.affected);
    const madeUnder = keep(effects.made_under, (r) => r.provision);
    const [c, e, m] = [bound(commencement, limit), bound(amendments, limit), bound(madeUnder, limit)];
    return envelope(legislationInfo, {
      data: {
        act: { title: effects.title, year, number, eli: actUri(year, number) },
        updated_to: effects.updated_to,
        revised_note: effects.revised_note,
        section: section ?? null,
        counts: { commencement: commencement.length, effects: amendments.length, made_under: madeUnder.length },
        commencement: c.items,
        effects: e.items,
        made_under: m.items,
        licence_terms: LICENCE_TERMS,
        warnings: [
          NOT_LEGAL_ADVICE,
          ENACTED_NOT_AMENDED,
          "These are directory entries, not the amended text. Check the affecting provision itself; Law Reform Commission Revised Acts are not served here."
        ]
      },
      url,
      cached: result.cached,
      stale: result.stale,
      truncated: c.truncated || e.truncated || m.truncated
    });
  }
});

export const legislationModule: SourceModule = {
  info: legislationInfo,
  summary: "Irish Statute Book: Acts and SIs as enacted/made, the Constitution, and Act amendments and commencement.",
  domain: "law/politics", card: legislationCard,
  coverage:
    "Acts of the Oireachtas as enacted and Statutory Instruments as made, from 1922 to the current year; the Constitution (eISB edition); Legislation Directory amendment and commencement entries (Irish Statute Book).",
  tools: [listActsTool, getActTool, getSectionTool, actEffectsTool, listSisTool, getSiTool, constitutionTool],
  async search(query, limit, ctx): Promise<SearchHit[]> {
    const now = ctx.now().getUTCFullYear();
    const mentioned = [...query.matchAll(/\b(19[2-9]\d|20\d\d)\b/g)].map((m) => Number(m[1])).filter((y) => y >= FIRST_YEAR && y <= now);
    const years = mentioned.length ? [...new Set(mentioned)] : [now, now - 1, now - 2];
    const words = query.toLowerCase().replace(/\b(19|20)\d\d\b/g, "").replace(/\bacts?\b/g, "").split(/\W+/).filter((w) => w.length > 2);
    if (!words.length) return [];
    const lists = await Promise.allSettled(years.map((y) => listActs(ctx, y).then((r) => ({ y, acts: r.acts }))));
    const hits: SearchHit[] = [];
    for (const l of lists) {
      if (l.status !== "fulfilled") continue;
      for (const a of l.value.acts) {
        if (words.every((w) => a.title.toLowerCase().includes(w))) hits.push({ id: `legislation:${l.value.y}/${a.number}`, title: a.title, url: a.url });
      }
    }
    return hits.slice(0, limit);
  },
  async fetchById(key, ctx): Promise<FetchedDocument> {
    const m = key.match(/^(\d{4})\/(\d{1,3})(?:\/s(\w+))?$/);
    if (!m) throw new ToolError("BAD_ARGS", "Legislation ids look like 'legislation:2018/7' or 'legislation:2018/7/s2'.");
    const [y, n, s] = [Number(m[1]), Number(m[2]), m[3]];
    const { act } = await loadAct(ctx, y, n);
    if (s) {
      const text = sectionText(act.xml, s);
      if (text === undefined) throw new ToolError("NOT_FOUND", `${act.title} has no section ${s}.`);
      return { id: `legislation:${key}`, title: `${act.title}, section ${s}`, text, url: sectionUri(y, n, s), metadata: { year: y, number: n, section: s, licence: legislationInfo.licence } };
    }
    const toc = listSections(act.xml).map((x) => `${x.number}. ${x.heading}`).join("\n");
    return {
      id: `legislation:${key}`,
      title: act.title,
      text: `${act.title} (Number ${n} of ${y}), enacted ${act.enacted ?? "unknown"}.\n\nSections:\n${toc}`,
      url: act.url,
      metadata: { year: y, number: n, enacted: act.enacted, licence: legislationInfo.licence }
    };
  }
};
