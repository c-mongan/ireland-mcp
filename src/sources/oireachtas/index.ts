import { z } from "zod";
import { HOUR } from "../../gateway/context.js";
import { bound, envelope, MAX_LIMIT, type SourceInfo } from "../../gateway/envelope.js";
import { ToolError } from "../../gateway/errors.js";
import { defineTool, type SourceModule, type ToolContext } from "../../gateway/module.js";

export const oireachtasInfo: SourceInfo = {
  id: "oireachtas",
  name: "Houses of the Oireachtas Open Data API",
  licence: "Oireachtas (Open Data) PSI Licence",
  attribution: "Contains Oireachtas information licensed under the Oireachtas (Open Data) PSI Licence.",
  homepage: "https://api.oireachtas.ie"
};

export const OIREACHTAS_API = "https://api.oireachtas.ie/v1";
const TTL = HOUR;
export const CURRENT_HOUSE = { dail: "34", seanad: "27" } as const;

/* eslint-disable @typescript-eslint/no-explicit-any -- the Oireachtas API is large and loosely typed; we pick fields defensively. */
type Json = any;

const limit = z.number().int().min(1).max(MAX_LIMIT).default(50).describe("Maximum results (1-500).");
const chamber = z.enum(["dail", "seanad"]).default("dail").describe("dail (Dáil Éireann) or seanad (Seanad Éireann).");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

function apiUrl(path: string, params: Record<string, string | number | undefined>): string {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join("&");
  return `${OIREACHTAS_API}/${path}${query ? `?${query}` : ""}`;
}

async function getList(ctx: ToolContext, path: string, params: Record<string, string | number | undefined>) {
  const url = apiUrl(path, params);
  const result = await ctx.cachedJson<{ head?: { counts?: Record<string, number> }; results?: Json[] }>(url, TTL, {
    label: "Oireachtas API"
  });
  if (!Array.isArray(result.value.results)) throw new ToolError("UPSTREAM_DOWN", "Oireachtas API returned an unexpected response.");
  const counts = result.value.head?.counts ?? {};
  const total = Object.entries(counts).find(([key]) => key !== "resultCount")?.[1] ?? result.value.results.length;
  return { url, results: result.value.results, total, cached: result.cached, stale: result.stale };
}

const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

function summariseMember(raw: Json, house: string) {
  const m = raw.member;
  const membership =
    (m.memberships ?? []).map((x: Json) => x.membership).find((x: Json) => x.house?.houseNo === house) ?? m.memberships?.[0]?.membership;
  const party = membership?.parties?.map((p: Json) => p.party).find((p: Json) => !p.dateRange?.end) ?? membership?.parties?.at(-1)?.party;
  const offices = (membership?.offices ?? [])
    .map((o: Json) => o.office)
    .filter((o: Json) => !o.dateRange?.end)
    .map((o: Json) => o.officeName?.showAs)
    .filter(Boolean);
  return {
    member_code: m.memberCode as string,
    name: m.fullName as string,
    party: (party?.showAs as string | undefined) ?? null,
    constituency: (membership?.represents?.[0]?.represent?.showAs as string | undefined) ?? null,
    house: (membership?.house?.showAs as string | undefined) ?? null,
    current_offices: offices,
    uri: m.uri as string
  };
}

function summariseBill(raw: Json) {
  const b = raw.bill;
  const stage = b.mostRecentStage?.event;
  return {
    bill: `${b.billYear}/${b.billNo}`,
    title: (b.shortTitleEn as string).trim(),
    status: b.status as string,
    source: b.source as string,
    origin_house: (b.originHouse?.showAs as string | undefined) ?? null,
    latest_stage: stage ? { stage: stage.showAs, chamber: stage.chamber?.showAs ?? null, date: stage.dates?.at(-1)?.date ?? null } : null,
    sponsors: (b.sponsors ?? []).map((s: Json) => s.sponsor?.by?.showAs ?? s.sponsor?.as?.showAs).filter(Boolean),
    act: b.act ? { title: b.act.shortTitleEn ?? null, act: `${b.act.actYear}/${b.act.actNo}` } : null,
    long_title: stripHtml(b.longTitleEn ?? "").slice(0, 600),
    last_updated: b.lastUpdated ?? null,
    url: `https://www.oireachtas.ie/en/bills/bill/${b.billYear}/${b.billNo}/`
  };
}

const stripHtml = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

async function membersOf(ctx: ToolContext, house: "dail" | "seanad", houseNo: string) {
  return getList(ctx, "members", { chamber: house, house_no: houseNo, limit: 300 });
}

const membersTool = defineTool({
  name: "oireachtas_search_members",
  title: "Search TDs and Senators",
  description:
    "Find members of the Dáil or Seanad by name, party or constituency. Defaults to the current 34th Dáil. Returns member codes usable with oireachtas_search_questions.",
  inputSchema: {
    name: z.string().max(80).optional().describe("Part of the member's name (accents optional)."),
    party: z.string().max(80).optional().describe("Party name, e.g. 'Fianna Fáil', 'Sinn Féin', 'Independent'."),
    constituency: z.string().max(80).optional().describe("Constituency or Seanad panel, e.g. 'Cork South-Central'."),
    chamber,
    house_no: z.string().regex(/^\d{1,2}$/).optional().describe("Dáil/Seanad number; defaults to the current house."),
    limit
  },
  handler: async ({ name, party, constituency, chamber: house, house_no, limit: max }, ctx) => {
    const houseNo = house_no ?? CURRENT_HOUSE[house];
    const list = await membersOf(ctx, house, houseNo);
    const matches = list.results
      .map((r) => summariseMember(r, houseNo))
      .filter(
        (m) =>
          (!name || fold(m.name).includes(fold(name))) &&
          (!party || fold(m.party ?? "").includes(fold(party))) &&
          (!constituency || fold(m.constituency ?? "").includes(fold(constituency)))
      );
    const { items, truncated } = bound(matches, max);
    return envelope(oireachtasInfo, { data: { total: matches.length, members: items }, url: list.url, cached: list.cached, stale: list.stale, truncated });
  }
});

const billsTool = defineTool({
  name: "oireachtas_search_bills",
  title: "Search Oireachtas bills",
  description:
    "Search bills before or passed by the Oireachtas, most recently updated first. Filter by words in the title, year and status (Current, Enacted, Lapsed, Withdrawn, Defeated, Rejected).",
  inputSchema: {
    query: z.string().max(120).optional().describe("Words that must appear in the bill's short title."),
    year: z.string().regex(/^\d{4}$/).optional().describe("Bill year, e.g. 2025."),
    status: z.enum(["Current", "Enacted", "Lapsed", "Withdrawn", "Defeated", "Rejected"]).optional(),
    limit
  },
  handler: async ({ query, year, status, limit: max }, ctx) => {
    const list = await getList(ctx, "legislation", { bill_year: year, bill_status: status, limit: query ? 500 : max, lang: "en" });
    const words = query ? fold(query).split(/\s+/).filter(Boolean) : [];
    const bills = list.results.map(summariseBill).filter((b) => words.every((w) => fold(`${b.title} ${b.long_title}`).includes(w)));
    const { items, truncated } = bound(bills, max);
    return envelope(oireachtasInfo, {
      data: { total: query ? bills.length : list.total, bills: items },
      url: list.url,
      cached: list.cached,
      stale: list.stale,
      truncated: truncated || (!query && list.total > items.length)
    });
  }
});

const debatesTool = defineTool({
  name: "oireachtas_get_debates",
  title: "Oireachtas debate records",
  description: "List sitting days of the Dáil or Seanad with the topics debated (section headings), most recent first.",
  inputSchema: {
    date_from: isoDate.optional().describe("Earliest date (YYYY-MM-DD)."),
    date_to: isoDate.optional().describe("Latest date (YYYY-MM-DD)."),
    chamber,
    limit: z.number().int().min(1).max(50).default(5).describe("Maximum sitting days (1-50)."),
    max_sections: z.number().int().min(1).max(100).default(25).describe("Maximum topics listed per day.")
  },
  handler: async ({ date_from, date_to, chamber: house, limit: max, max_sections }, ctx) => {
    const list = await getList(ctx, "debates", {
      chamber_type: "house",
      chamber: house,
      date_start: date_from,
      date_end: date_to,
      limit: max,
      lang: "en"
    });
    const days = list.results.slice(0, max).map((r) => {
      const d = r.debateRecord;
      const sections = (d.debateSections ?? []).map((s: Json) => s.debateSection);
      return {
        date: d.date as string,
        chamber: d.chamber?.showAs ?? null,
        house: d.house?.showAs ?? null,
        counts: d.counts ?? null,
        topics: sections.slice(0, max_sections).map((s: Json) => ({
          title: s.showAs,
          type: s.debateType,
          speakers: s.counts?.speakerCount ?? null
        })),
        total_topics: sections.length,
        url: `https://www.oireachtas.ie/en/debates/debate/${house}/${d.date}/`
      };
    });
    return envelope(oireachtasInfo, {
      data: { total: list.total, days },
      url: list.url,
      cached: list.cached,
      stale: list.stale,
      truncated: list.total > days.length || days.some((d) => d.total_topics > d.topics.length)
    });
  }
});

const questionsTool = defineTool({
  name: "oireachtas_search_questions",
  title: "Parliamentary questions",
  description:
    "Parliamentary questions put to ministers. Filter by asking member (member_code from oireachtas_search_members), dates and oral/written type.",
  inputSchema: {
    member_code: z.string().max(120).optional().describe("Member code, e.g. Simon-Harris.D.2011-03-09."),
    date_from: isoDate.optional(),
    date_to: isoDate.optional(),
    type: z.enum(["oral", "written"]).optional(),
    limit
  },
  handler: async ({ member_code, date_from, date_to, type, limit: max }, ctx) => {
    const list = await getList(ctx, "questions", {
      member_id: member_code ? `https://data.oireachtas.ie/ie/oireachtas/member/id/${member_code}` : undefined,
      date_start: date_from,
      date_end: date_to,
      qtype: type,
      limit: max
    });
    const questions = list.results.slice(0, max).map((r) => {
      const q = r.question;
      return {
        date: q.date as string,
        type: q.questionType as string,
        number: q.questionNumber ?? null,
        asked_by: q.by?.showAs ?? null,
        to: q.to?.showAs ?? null,
        topic: q.debateSection?.showAs ?? null,
        question: String(q.showAs ?? "").trim(),
        uri: q.uri as string
      };
    });
    return envelope(oireachtasInfo, {
      data: { total: list.total, questions },
      url: list.url,
      cached: list.cached,
      stale: list.stale,
      truncated: list.total > questions.length
    });
  }
});

const votesTool = defineTool({
  name: "oireachtas_get_votes",
  title: "Dáil and Seanad divisions",
  description: "Recorded votes (divisions) with subject, outcome and Tá/Níl/Staon tallies. Use dates to narrow.",
  inputSchema: { date_from: isoDate.optional(), date_to: isoDate.optional(), chamber, limit },
  handler: async ({ date_from, date_to, chamber: house, limit: max }, ctx) => {
    const list = await getList(ctx, "divisions", {
      chamber_type: "house",
      chamber: house,
      date_start: date_from,
      date_end: date_to,
      limit: max
    });
    const votes = list.results.slice(0, max).map((r) => {
      const d = r.division;
      const tally = (key: string) => d.tallies?.[key]?.tally ?? 0;
      return {
        date: d.date as string,
        vote_id: d.voteId as string,
        debate: d.debate?.showAs ?? null,
        subject: String(d.subject?.showAs ?? "").trim() || null,
        outcome: d.outcome as string,
        ta: tally("taVotes"),
        nil: tally("nilVotes"),
        staon: tally("staonVotes"),
        uri: d.uri as string
      };
    });
    return envelope(oireachtasInfo, {
      data: { total: list.total, votes },
      url: list.url,
      cached: list.cached,
      stale: list.stale,
      truncated: list.total > votes.length
    });
  }
});

async function search(query: string, max: number, ctx: ToolContext) {
  const [members, bills] = await Promise.all([
    membersOf(ctx, "dail", CURRENT_HOUSE.dail),
    getList(ctx, "legislation", { limit: 500, lang: "en" })
  ]);
  const words = fold(query).split(/\s+/).filter((w) => w.length > 2);
  const score = (text: string) => words.filter((w) => fold(text).includes(w)).length;
  const hits = [
    ...members.results.map((r) => summariseMember(r, CURRENT_HOUSE.dail)).map((m) => ({
      s: score(`${m.name} ${m.party ?? ""} ${m.constituency ?? ""}`),
      hit: { id: `oireachtas:member/${m.member_code}`, title: `${m.name} TD (${m.party ?? "?"}, ${m.constituency ?? "?"})`, url: m.uri }
    })),
    ...bills.results.map(summariseBill).map((b) => ({
      s: score(b.title),
      hit: { id: `oireachtas:bill/${b.bill}`, title: `${b.title} [${b.status}]`, url: b.url }
    }))
  ];
  return hits
    .filter((h) => h.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, max)
    .map((h) => h.hit);
}

async function fetchById(key: string, ctx: ToolContext) {
  const meta = { source: oireachtasInfo.name, licence: oireachtasInfo.licence, attribution: oireachtasInfo.attribution };
  const bill = key.match(/^bill\/(\d{4})\/(\d+)$/);
  if (bill) {
    const list = await getList(ctx, "legislation", { bill_year: bill[1], bill_no: bill[2], lang: "en" });
    if (!list.results[0]) throw new ToolError("NOT_FOUND", `No bill ${bill[1]}/${bill[2]}.`);
    const b = summariseBill(list.results[0]);
    const text = [
      `${b.title} (${b.bill})`,
      `Status: ${b.status}. Source: ${b.source}. Origin: ${b.origin_house ?? "?"}.`,
      b.latest_stage ? `Latest stage: ${b.latest_stage.stage} (${b.latest_stage.chamber ?? ""}, ${b.latest_stage.date ?? ""}).` : "",
      b.sponsors.length ? `Sponsors: ${b.sponsors.join(", ")}.` : "",
      b.act ? `Enacted as ${b.act.title ?? ""} (${b.act.act}).` : "",
      b.long_title
    ]
      .filter(Boolean)
      .join("\n");
    return { id: `oireachtas:${key}`, title: b.title, text, url: b.url, metadata: { ...meta, api: list.url } };
  }
  const member = key.match(/^member\/(.+)$/);
  if (member) {
    const list = await membersOf(ctx, "dail", CURRENT_HOUSE.dail);
    const raw = list.results.find((r) => r.member?.memberCode === member[1]);
    if (!raw) throw new ToolError("NOT_FOUND", `No current TD with code ${member[1]}.`);
    const m = summariseMember(raw, CURRENT_HOUSE.dail);
    const text = [
      `${m.name} — ${m.house ?? ""}`,
      `Party: ${m.party ?? "?"}. Constituency: ${m.constituency ?? "?"}.`,
      m.current_offices.length ? `Current offices: ${m.current_offices.join("; ")}.` : ""
    ]
      .filter(Boolean)
      .join("\n");
    return { id: `oireachtas:${key}`, title: m.name, text, url: m.uri, metadata: { ...meta, api: list.url } };
  }
  throw new ToolError("BAD_ARGS", `Unknown Oireachtas id "${key}".`, { hint: "Ids look like oireachtas:bill/2024/101 or oireachtas:member/<code>." });
}

export const oireachtasModule: SourceModule = {
  info: oireachtasInfo,
  summary: "Parliament: TDs and Senators, bills and their stages, debates, parliamentary questions and votes.",
  tools: [membersTool, billsTool, debatesTool, questionsTool, votesTool],
  search,
  fetchById
};
