import { z } from "zod";
import { HOUR } from "../../gateway/context.js";
import { envelope, type SourceInfo } from "../../gateway/envelope.js";
import { ToolError } from "../../gateway/errors.js";
import { defineTool, type FetchedDocument, type SearchHit, type SourceModule, type ToolContext } from "../../gateway/module.js";

export const tedInfo: SourceInfo = {
  id: "ted",
  name: "EU Tenders Electronic Daily (TED)",
  licence: "EU reuse policy / Creative Commons Attribution 4.0 International (CC BY 4.0)",
  attribution: "Source: Tenders Electronic Daily (TED), Publications Office of the European Union. Reuse under CC BY 4.0 with attribution.",
  homepage: "https://ted.europa.eu/"
};

const TED_SEARCH = "https://api.ted.europa.eu/v3/notices/search";
const FIELDS = [
  "publication-number",
  "notice-title",
  "organisation-name-buyer",
  "total-value",
  "total-value-cur",
  "estimated-value-proc",
  "estimated-value-cur-proc",
  "deadline-receipt-tender-date-lot",
  "deadline-receipt-tender-time-lot"
];

interface TedResponse {
  notices?: TedNotice[];
  totalNoticeCount?: number;
  iterationNextToken?: string | null;
  timedOut?: boolean;
}

interface TedNotice {
  "publication-number"?: string;
  "notice-title"?: Record<string, string>;
  "organisation-name-buyer"?: Record<string, string[] | string>;
  "total-value"?: number | number[];
  "total-value-cur"?: string | string[];
  "estimated-value-proc"?: number | number[];
  "estimated-value-cur-proc"?: string | string[];
  "deadline-receipt-tender-date-lot"?: string | string[];
  "deadline-receipt-tender-time-lot"?: string | string[];
  links?: { html?: Record<string, string>; htmlDirect?: Record<string, string>; xml?: Record<string, string> };
}

const first = <T>(v: T | T[] | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const localised = (m?: Record<string, string>) => m?.eng ?? m?.gle ?? Object.values(m ?? {})[0] ?? null;
const buyer = (m?: Record<string, string[] | string>) => {
  const v = m?.eng ?? m?.gle ?? Object.values(m ?? {})[0];
  return first(v) ?? null;
};
const link = (n: TedNotice) => n.links?.html?.ENG ?? n.links?.html?.eng ?? n.links?.htmlDirect?.ENG ?? n.links?.xml?.MUL ?? null;

function safePhrase(text: string): string {
  return text
    .replace(/[()]/g, " ")
    .replace(/["\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactDate(d: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new ToolError("BAD_ARGS", "TED dates must be YYYY-MM-DD.");
  return d.replaceAll("-", "");
}

function cpvQuery(cpv: string): string {
  if (!/^\d{2,8}$/.test(cpv)) throw new ToolError("BAD_ARGS", "CPV must be 2 to 8 digits.");
  return `classification-cpv=${cpv}`;
}

function buildQuery(args: { text?: string; buyer?: string; cpv?: string; since?: string; until?: string; notice_type?: string }) {
  const parts = ["buyer-country=IRL"];
  if (args.text) {
    const safe = safePhrase(args.text);
    if (safe) parts.push(`FT~"${safe}"`);
  }
  if (args.buyer) {
    const safe = safePhrase(args.buyer);
    if (safe) parts.push(`buyer-name~"${safe}"`);
  }
  if (args.cpv) parts.push(cpvQuery(args.cpv));
  if (args.notice_type) {
    if (!/^[A-Za-z0-9_-]{2,60}$/.test(args.notice_type)) throw new ToolError("BAD_ARGS", "Notice type must be a TED notice type token.");
    parts.push(`notice-type=${args.notice_type}`);
  }
  if (args.since) parts.push(`PD>=${compactDate(args.since)}`);
  if (args.until) parts.push(`PD<=${compactDate(args.until)}`);
  return `${parts.join(" AND ")} SORT BY publication-date DESC`;
}

function normalise(n: TedNotice) {
  const amount = first(n["total-value"]) ?? first(n["estimated-value-proc"]);
  const currency = first(n["total-value-cur"]) ?? first(n["estimated-value-cur-proc"]);
  const date = first(n["deadline-receipt-tender-date-lot"]);
  const time = first(n["deadline-receipt-tender-time-lot"]);
  const id = n["publication-number"] ?? "";
  return {
    id,
    title: localised(n["notice-title"]),
    buyer: buyer(n["organisation-name-buyer"]),
    value: { amount: typeof amount === "number" && amount > 0 ? amount : null, currency },
    deadline: date ? `${date}${time ? `T${time}` : ""}` : null,
    links: { html: link(n), api: TED_SEARCH }
  };
}

async function searchTed(ctx: ToolContext, query: string, limit: number, page = 1) {
  const body = JSON.stringify({ query, fields: FIELDS, limit, page, paginationMode: "PAGE_NUMBER" });
  return ctx.cachedJson<TedResponse>(TED_SEARCH, HOUR, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    label: "TED search API",
    maxBytes: 1024 * 1024,
    validate: (value) => {
      if (!Array.isArray(value.notices)) throw new ToolError("UPSTREAM_DOWN", "TED returned an unexpected search response.");
    }
  });
}

const searchTool = defineTool({
  name: "ted_search_tenders",
  title: "Search Irish TED tenders",
  description:
    "Search EU Tenders Electronic Daily notices, always constrained to Irish buyers (buyer-country=IRL). Free text is escaped into TED expert-search syntax.",
  inputSchema: {
    text: z.string().min(1).max(120).optional().describe("Free-text tender search, safely quoted in TED full-text search."),
    buyer: z.string().min(2).max(120).optional().describe("Buyer/contracting authority name."),
    cpv: z.string().regex(/^\d{2,8}$/).optional().describe("CPV prefix/code, digits only."),
    since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    notice_type: z.string().min(2).max(60).optional().describe("TED notice type token, e.g. cn-standard."),
    limit: z.number().int().min(1).max(100).default(25),
    cursor: z.string().regex(/^\d+$/).optional().describe("Next cursor returned by a previous page.")
  },
  handler: async ({ limit, cursor, ...args }, ctx) => {
    const page = cursor ? Number(cursor) : 1;
    const query = buildQuery(args);
    const r = await searchTed(ctx, query, limit, page);
    const tenders = (r.value.notices ?? []).map(normalise);
    const total = r.value.totalNoticeCount ?? tenders.length;
    const next = page * limit < total ? String(page + 1) : null;
    return envelope(tedInfo, {
      data: { query, page, limit, total, next_cursor: next, tenders },
      url: TED_SEARCH,
      cached: r.cached,
      stale: r.stale,
      truncated: Boolean(r.value.timedOut)
    });
  }
});

const getTool = defineTool({
  name: "ted_get_notice",
  title: "Get one Irish TED notice",
  description: "Fetch one TED notice by publication number using the keyless search endpoint, constrained to Irish buyers.",
  example: { id: "646747-2026" },
  inputSchema: { id: z.string().regex(/^\d{6}-\d{4}$/).describe("TED publication number, e.g. 646747-2026.") },
  handler: async ({ id }, ctx) => {
    const query = `buyer-country=IRL AND publication-number=${id}`;
    const r = await searchTed(ctx, query, 1);
    const notice = (r.value.notices ?? []).find((n) => n["publication-number"] === id) ?? r.value.notices?.[0];
    if (!notice) throw new ToolError("NOT_FOUND", `No Irish TED notice found for ${id}.`);
    return envelope(tedInfo, { data: { notice: normalise(notice), raw: notice }, url: link(notice) ?? TED_SEARCH, cached: r.cached, stale: r.stale });
  }
});

export const tedModule: SourceModule = {
  info: tedInfo,
  summary: "Procurement: Irish-buyer EU TED tender notices, values, deadlines and notice links.",
  domain: "economy",
  coverage: "Published EU TED notices where buyer-country is Ireland (IRL); search endpoint is keyless.",
  tools: [searchTool, getTool],
  search: async (query, limit, ctx): Promise<SearchHit[]> => {
    const r = await searchTed(ctx, buildQuery({ text: query }), Math.min(limit, 10));
    return (r.value.notices ?? []).map(normalise).map((n) => ({ id: `ted:${n.id}`, title: n.title ?? n.id, url: n.links.html ?? tedInfo.homepage }));
  },
  fetchById: async (key, ctx): Promise<FetchedDocument> => {
    const r = await getTool.handler({ id: key }, ctx) as { data: { notice: ReturnType<typeof normalise> }; url: string };
    return { id: `ted:${key}`, title: r.data.notice.title ?? key, text: JSON.stringify(r.data.notice), url: r.url, metadata: { source: "ted" } };
  }
};
