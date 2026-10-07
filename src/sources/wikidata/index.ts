import { z } from "zod";
import { DAY } from "../../gateway/context.js";
import { bound, envelope, type SourceInfo } from "../../gateway/envelope.js";
import { ToolError } from "../../gateway/errors.js";
import { defineTool, type SourceModule, type ToolContext } from "../../gateway/module.js";

const ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT = "ireland-mcp/1.0 (templated Irish public-data lookup; https://github.com/c-mongan/ireland-mcp)";
const limitSchema = z.number().int().min(1).max(25).default(10).describe("Maximum matches to return (1-25).");

export const wikidataInfo: SourceInfo = {
  id: "wikidata",
  name: "Wikidata Query Service",
  licence: "CC0 1.0 Public Domain Dedication",
  attribution: "Source: Wikidata contributors, CC0.",
  homepage: "https://www.wikidata.org"
};

interface BindingValue { type: string; value: string; datatype?: string; "xml:lang"?: string }
interface SparqlJson { head?: { vars?: string[] }; results?: { bindings?: Array<Record<string, BindingValue>> } }

function assertSparql(value: unknown): SparqlJson {
  const data = value as SparqlJson | null;
  if (!data || !Array.isArray(data.results?.bindings)) throw new ToolError("UPSTREAM_DOWN", "Wikidata returned an unexpected SPARQL response.");
  return data;
}

function literal(value: string): string {
  return JSON.stringify(value);
}

function qidFromUri(uri: string | undefined): string | null {
  const match = uri?.match(/\/entity\/(Q\d+)$/);
  return match?.[1] ?? null;
}

function parsePoint(raw: string | undefined): { lat: number; lon: number } | null {
  const match = raw?.match(/^Point\((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\)$/);
  return match ? { lon: Number(match[1]), lat: Number(match[2]) } : null;
}

const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

interface PlaceMatch {
  qid: string;
  label: string | null;
  exact_label: boolean;
  description: string | null;
  irish_name: string | null;
  population: number | null;
  county_or_admin: string | null;
  county_qid: string | null;
  coordinates: { lat: number; lon: number } | null;
  website: string | null;
  url: string | null;
}

function sparqlUrl(query: string): string {
  const params = new URLSearchParams({ query, format: "json" });
  return `${ENDPOINT}?${params.toString()}`;
}

async function query(ctx: ToolContext, sparql: string) {
  const url = sparqlUrl(sparql);
  const result = await ctx.cachedJson<SparqlJson>(url, 7 * DAY, {
    label: "Wikidata Query Service",
    timeoutMs: 6_000,
    retries: 0,
    maxBytes: 1_500_000,
    headers: { accept: "application/sparql-results+json", "user-agent": USER_AGENT },
    validate: assertSparql
  });
  return { ...result, url };
}

const placeTool = defineTool({
  name: "wikidata_place",
  title: "Irish place from Wikidata",
  description: "Find Irish places by English name or alias using Wikidata's entity search and a safe template (country filter wd:Q27). Exact name matches come first (exact_label=true). Returns population, county/admin area, coordinates, Irish name and website when available.",
  example: { name: "Galway" },
  inputSchema: { name: z.string().min(2).max(80).describe("Irish place label or alias, e.g. Galway or Cork."), limit: limitSchema },
  handler: async ({ name, limit }, ctx) => {
    // Wikidata's EntitySearch (label + alias prefix index) answers in well under a second; the old
    // full LCASE label scan timed out for any uncached town. Exact label matches are ranked first.
    const sparql = `SELECT ?place ?ordinal ?placeLabel ?placeDescription ?irishLabel ?population ?county ?countyLabel ?coord ?website WHERE {
  SERVICE wikibase:mwapi {
    bd:serviceParam wikibase:endpoint "www.wikidata.org"; wikibase:api "EntitySearch";
      mwapi:search ${literal(name.trim())}; mwapi:language "en"; mwapi:limit "50".
    ?place wikibase:apiOutputItem mwapi:item.
    ?ordinal wikibase:apiOrdinal true.
  }
  ?place wdt:P17 wd:Q27.
  OPTIONAL { ?place wdt:P1082 ?population. }
  OPTIONAL { ?place wdt:P131 ?county. }
  OPTIONAL { ?place wdt:P625 ?coord. }
  OPTIONAL { ?place rdfs:label ?irishLabel FILTER(LANG(?irishLabel) = "ga") }
  OPTIONAL { ?place wdt:P856 ?website. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} ORDER BY ?ordinal LIMIT 100`;
    const result = await query(ctx, sparql);
    const wanted = fold(name);
    const byQid = new Map<string, PlaceMatch>();
    for (const row of result.value.results?.bindings ?? []) {
      const qid = qidFromUri(row.place?.value);
      if (!qid || byQid.has(qid)) continue;
      const label = row.placeLabel?.value ?? null;
      byQid.set(qid, {
        qid,
        label,
        exact_label: label !== null && fold(label) === wanted,
        description: row.placeDescription?.value ?? null,
        irish_name: row.irishLabel?.value ?? null,
        population: row.population?.value ? Number(row.population.value) : null,
        county_or_admin: row.countyLabel?.value ?? null,
        county_qid: qidFromUri(row.county?.value),
        coordinates: parsePoint(row.coord?.value),
        website: row.website?.value ?? null,
        url: `https://www.wikidata.org/wiki/${qid}`
      });
    }
    // Stable sort keeps Wikidata's relevance order within the exact and partial groups.
    const matches = [...byQid.values()].sort((a, b) => Number(b.exact_label) - Number(a.exact_label));
    const { items, truncated } = bound(matches, limit);
    return envelope(wikidataInfo, { data: { name, matches: items, total: matches.length }, url: result.url, cached: result.cached, stale: result.stale, truncated });
  }
});

const entityTool = defineTool({
  name: "wikidata_entity",
  title: "Wikidata entity summary",
  description: "Summarise a single Wikidata entity by QID using a safe template. Does not accept arbitrary SPARQL.",
  example: { qid: "Q27" },
  inputSchema: { qid: z.string().regex(/^Q\d+$/).describe("Wikidata entity id, e.g. Q27 for Ireland.") },
  handler: async ({ qid }, ctx) => {
    const sparql = `SELECT ?item ?itemLabel ?itemDescription ?irishLabel ?instanceLabel ?countryLabel ?population ?coord ?website WHERE {
  BIND(wd:${qid} AS ?item)
  OPTIONAL { ?item rdfs:label ?irishLabel FILTER(LANG(?irishLabel) = "ga") }
  OPTIONAL { ?item wdt:P31 ?instance. }
  OPTIONAL { ?item wdt:P17 ?country. }
  OPTIONAL { ?item wdt:P1082 ?population. }
  OPTIONAL { ?item wdt:P625 ?coord. }
  OPTIONAL { ?item wdt:P856 ?website. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
    const result = await query(ctx, sparql);
    const row = result.value.results?.bindings?.[0];
    if (!row) throw new ToolError("NOT_FOUND", `No Wikidata entity ${qid} was returned.`);
    return envelope(wikidataInfo, {
      data: {
        qid,
        label: row.itemLabel?.value ?? null,
        description: row.itemDescription?.value ?? null,
        irish_name: row.irishLabel?.value ?? null,
        instance_of: row.instanceLabel?.value ?? null,
        country: row.countryLabel?.value ?? null,
        population: row.population?.value ? Number(row.population.value) : null,
        coordinates: parsePoint(row.coord?.value),
        website: row.website?.value ?? null,
        url: `https://www.wikidata.org/wiki/${qid}`
      },
      url: result.url,
      cached: result.cached,
      stale: result.stale,
      truncated: false
    });
  }
});

async function search(term: string, max: number, ctx: ToolContext) {
  const { data } = (await placeTool.handler({ name: term, limit: Math.min(max, 10) }, ctx)) as ReturnType<typeof envelope<{ matches: PlaceMatch[] }>>;
  return data.matches.filter((m) => m.qid && m.url).map((m) => ({ id: `wikidata:${m.qid}`, title: `${m.label ?? m.qid} (Wikidata ${m.qid})`, url: m.url! }));
}

export const wikidataModule: SourceModule = {
  info: wikidataInfo,
  summary: "Safe Wikidata templates for Irish places and entity summaries (no arbitrary SPARQL exposed).",
  domain: "places/property",
  coverage: "Wikidata entities, with place lookup constrained to items whose country is Ireland (wd:Q27).",
  tools: [placeTool, entityTool],
  search
};
