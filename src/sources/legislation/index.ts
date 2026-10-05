import { z } from "zod";
import { DAY } from "../../gateway/context.js";
import { bound, envelope, type SourceInfo } from "../../gateway/envelope.js";
import { ToolError } from "../../gateway/errors.js";
import { defineTool, type FetchedDocument, type SearchHit, type SourceModule, type ToolContext } from "../../gateway/module.js";

// Approach adapted from ie-eli-mcp (Apache-2.0): address Acts by their ELI URI and read the eISB XML rendering.
export const legislationInfo: SourceInfo = {
  id: "legislation",
  name: "Irish Statute Book (eISB) via ELI",
  licence: "Re-use under the PSI General Licence / CC BY 4.0",
  attribution: "Contains Irish Statute Book data © Office of the Attorney General, made available by the eISB.",
  homepage: "https://www.irishstatutebook.ie"
};

export const EISB = "https://www.irishstatutebook.ie";
const TTL = DAY;
const FIRST_YEAR = 1922;

export const actUri = (year: number, number: number) => `${EISB}/eli/${year}/act/${number}/enacted/en/html`;
export const sectionUri = (year: number, number: number, section: string) =>
  `${EISB}/eli/${year}/act/${number}/section/${section}/enacted/en/html`;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Converts eISB act XML or listing HTML fragments into readable plain text. */
export function toText(fragment: string): string {
  return decodeEntities(stripTags(fragment))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Strips until stable so crafted input like "<<b>script>" cannot leave a tag behind, then drops stray brackets. */
function stripTags(fragment: string): string {
  let text = fragment;
  let before: string;
  do {
    before = text;
    text = text.replace(/<fn>[\s\S]*?<\/fn>/g, "");
  } while (text !== before);
  text = text
    .replace(/<odq\/>/g, "“")
    .replace(/<cdq\/>/g, "”")
    .replace(/<osq\/>/g, "‘")
    .replace(/<csq\/>/g, "’")
    .replace(/<(emdash|endash)\/>/g, (_m, t: string) => (t === "emdash" ? "—" : "–"))
    .replace(/<\/p>/g, "\n");
  let previous: string;
  do {
    previous = text;
    text = text.replace(/<[^>]*>/g, "");
  } while (text !== previous);
  return text.replace(/[<>]/g, "");
}

/** Decodes entities after tag stripping; out-of-range numeric entities are left as written. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? m;
    const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

export interface Act {
  year: number;
  number: number;
  title: string;
  enacted: string | null;
  url: string;
  xml: string;
}

function checkYear(year: number, now: Date) {
  if (year < FIRST_YEAR || year > now.getUTCFullYear()) {
    throw new ToolError("BAD_ARGS", `The eISB covers Acts from ${FIRST_YEAR} to ${now.getUTCFullYear()}.`);
  }
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
      data: { title: act.title, year, number, enacted: act.enacted, eli: act.url, sections: sections.items, note: "Text is the Act as enacted; check the Revised Acts for amendments." },
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

export const legislationModule: SourceModule = {
  info: legislationInfo,
  summary: "Acts of the Oireachtas from the Irish Statute Book: list by year, contents and section text (as enacted).",
  domain: "law/politics",
  coverage: "Acts of the Oireachtas as enacted, from 1922 to the current year (Irish Statute Book).",
  tools: [listActsTool, getActTool, getSectionTool],
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
