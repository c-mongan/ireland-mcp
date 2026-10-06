import { z } from "zod";
import { DAY } from "../../gateway/context.js";
import { bound, envelope, MAX_LIMIT, type SourceInfo } from "../../gateway/envelope.js";
import { ToolError } from "../../gateway/errors.js";
import { defineTool, type FetchedDocument, type SearchHit, type SourceModule, type ToolContext } from "../../gateway/module.js";

const BASE = "https://kohesio.ec.europa.eu/api";
const IRELAND = "https://linkedopendata.eu/entity/Q2";
const TTL = DAY;

export const kohesioInfo: SourceInfo = {
  id: "kohesio",
  name: "Kohesio EU-funded projects",
  licence: "European Commission reuse policy / CC BY 4.0 compatible",
  attribution: "European Commission, Kohesio platform.",
  homepage: "https://kohesio.ec.europa.eu/"
};

interface ProjectListResponse { list?: RawProject[]; numberResults?: number; similarWords?: string[] }
interface RawProject {
  link?: string;
  item?: string;
  labels?: string[];
  descriptions?: string[];
  startTimes?: string[];
  endTimes?: string[];
  euBudgets?: string[];
  totalBudgets?: string[];
  coordinates?: string[];
  countrycode?: string[];
}
interface DetailProject extends RawProject {
  budget?: string;
  description?: string;
  euBudget?: string;
  label?: string;
  countryLabel?: string[];
  beneficiaries?: Array<{ beneficiaryLabel?: string; link?: string; website?: string }>;
  funds?: Array<{ id?: string; label?: string; fullLabel?: string; website?: string }>;
  regions?: Array<{ label?: string }>;
  categoryLabels?: string[];
}

function first(value: unknown): string | null {
  if (Array.isArray(value)) return typeof value[0] === "string" && value[0].trim() ? value[0] : null;
  return typeof value === "string" && value.trim() ? value : null;
}
function text(value: unknown): string | null {
  const raw = first(value);
  return raw ? raw.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim() : null;
}
function money(value: unknown): number | null {
  const raw = first(value);
  if (!raw) return null;
  const n = Number(raw.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function projectId(idOrUrl: string): string {
  const id = idOrUrl.trim();
  if (/^Q\d+$/.test(id)) return `https://linkedopendata.eu/entity/${id}`;
  if (/^https:\/\/linkedopendata\.eu\/entity\/Q\d+$/.test(id)) return id;
  throw new ToolError("BAD_ARGS", "Project id must be a Kohesio Q id, e.g. Q232198, or its linkedopendata.eu URL.");
}
function compactProject(p: RawProject | DetailProject) {
  return {
    id: p.item ?? first(p.link)?.split("/").pop() ?? null,
    title: text((p as DetailProject).label) ?? text(p.labels) ?? null,
    description: text((p as DetailProject).description) ?? text(p.descriptions),
    start: first(p.startTimes),
    end: first(p.endTimes),
    eu_budget: money(p.euBudgets ?? (p as DetailProject).euBudget),
    total_budget: money(p.totalBudgets ?? (p as DetailProject).budget),
    coordinates: first(p.coordinates),
    country: first((p as DetailProject).countryLabel) ?? first(p.countrycode),
    beneficiaries: ((p as DetailProject).beneficiaries ?? []).slice(0, 5).map((b) => ({ name: b.beneficiaryLabel ?? null, url: b.link ?? null, website: b.website || null })),
    funds: ((p as DetailProject).funds ?? []).slice(0, 5).map((f) => ({ id: f.id ?? null, label: f.fullLabel ?? f.label ?? null, website: f.website ?? null })),
    categories: ((p as DetailProject).categoryLabels ?? []).slice(0, 8),
    url: p.link ?? (p.item ? `https://linkedopendata.eu/entity/${p.item}` : null)
  };
}

async function getJson<T>(ctx: ToolContext, url: string) {
  try {
    const result = await ctx.cachedJson<T>(url, TTL, { label: "Kohesio" });
    return { url, value: result.value, cached: result.cached, stale: result.stale };
  } catch (error) {
    if (error instanceof ToolError && error.message.includes("HTTP 403")) {
      throw new ToolError("UPSTREAM_DOWN", "Kohesio returned HTTP 403.", {
        hint: "Kohesio blocks some cloud-hosted IPs; run Ireland MCP from a built source checkout with node dist/src/cli.js --toolsets=kohesio (stdio)."
      });
    }
    throw error;
  }
}

const searchTool = defineTool({
  name: "kohesio_search_projects",
  title: "Search EU-funded Irish projects",
  description: "Search Kohesio EU cohesion-funded projects in Ireland by keyword, town/region, fund or budget filters.",
  example: { query: "Galway", limit: 5 },
  inputSchema: {
    query: z.string().max(120).optional().describe("Keyword search, e.g. 'Galway', 'university' or 'SME'."),
    region: z.string().max(100).optional().describe("Kohesio region filter if known."),
    min_eu_budget: z.number().nonnegative().optional(),
    limit: z.number().int().min(1).max(MAX_LIMIT).default(10),
    offset: z.number().int().min(0).max(100_000).default(0)
  },
  handler: async ({ query, region, min_eu_budget, limit, offset }, ctx) => {
    const params = new URLSearchParams({ country: IRELAND, limit: String(limit), offset: String(offset), language: "en" });
    if (query) params.set("keywords", query);
    if (region) params.set("region", region);
    if (min_eu_budget !== undefined) params.set("budgetEUBiggerThan", String(min_eu_budget));
    const result = await getJson<ProjectListResponse>(ctx, `${BASE}/projects?${params.toString()}`);
    const projects = (result.value.list ?? []).map(compactProject);
    const { items, truncated } = bound(projects, limit);
    return envelope(kohesioInfo, { data: { total: result.value.numberResults ?? projects.length, projects: items }, url: result.url, cached: result.cached, stale: result.stale, truncated: truncated || (result.value.numberResults ?? 0) > offset + items.length });
  }
});

const getTool = defineTool({
  name: "kohesio_get_project",
  title: "Get a Kohesio project",
  description: "Get one Kohesio EU-funded project by its Q id from kohesio_search_projects.",
  example: { id: "Q232198" },
  inputSchema: { id: z.string().min(2).max(120).describe("Kohesio project id, e.g. Q232198, or linkedopendata.eu entity URL.") },
  handler: async ({ id }, ctx) => {
    const urlId = projectId(id);
    const encoded = encodeURIComponent(urlId);
    const result = await getJson<DetailProject>(ctx, `${BASE}/projects/${encoded}?id=${encoded}&language=en`);
    return envelope(kohesioInfo, { data: compactProject(result.value), url: result.url, cached: result.cached, stale: result.stale });
  }
});

export const kohesioModule: SourceModule = {
  info: kohesioInfo,
  summary: "EU cohesion-funded projects and beneficiaries in Ireland from the European Commission Kohesio platform.",
  domain: "economy",
  coverage: "Irish EU-funded projects indexed by Kohesio across available programming periods.",
  tools: [searchTool, getTool],
  async search(query: string, limit: number, ctx: ToolContext): Promise<SearchHit[]> {
    const params = new URLSearchParams({ country: IRELAND, keywords: query, limit: String(limit), offset: "0", language: "en" });
    const result = await getJson<ProjectListResponse>(ctx, `${BASE}/projects?${params.toString()}`);
    return (result.value.list ?? []).slice(0, limit).map((p) => ({ id: `${kohesioInfo.id}:${p.item}`, title: text(p.labels) ?? p.item ?? "Kohesio project", url: p.link ?? kohesioInfo.homepage }));
  },
  async fetchById(key: string, ctx: ToolContext): Promise<FetchedDocument> {
    const id = key.replace(/^project:/, "");
    const urlId = projectId(id);
    const encoded = encodeURIComponent(urlId);
    const result = await getJson<DetailProject>(ctx, `${BASE}/projects/${encoded}?id=${encoded}&language=en`);
    const data = compactProject(result.value);
    return { id: `${kohesioInfo.id}:${data.id}`, title: data.title ?? String(data.id), text: JSON.stringify(data, null, 2), url: result.url, metadata: { source: kohesioInfo.id } };
  }
};
