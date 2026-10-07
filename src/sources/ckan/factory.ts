import { z } from "zod";
import { HOUR } from "../../gateway/context.js";
import { bound, envelope, MAX_LIMIT, type SourceInfo } from "../../gateway/envelope.js";
import { ToolError } from "../../gateway/errors.js";
import { defineTool, type Domain, type SourceModule, type ToolContext } from "../../gateway/module.js";

/** Minimal CKAN 2.x action API client shared by data.gov.ie and Smart Dublin. */
export interface CkanConfig {
  info: SourceInfo;
  /** Tool-name prefix, e.g. "datagov". */
  prefix: string;
  /** Portal display name used in descriptions. */
  portal: string;
  /** Site root, e.g. https://data.gov.ie */
  site: string;
  summary: string;
  domain: Domain;
  coverage: string;
  ttlMs?: number;
  /** Portal-specific examples for tool descriptions; defaults suit data.gov.ie. */
  examples?: { query: string; organization: string; dataset: string };
}

const DEFAULT_EXAMPLES = { query: "'bike counts' or 'air quality'", organization: "dublin-city-council", dataset: "moby-bikes" };

interface CkanEnvelope<T> {
  success: boolean;
  result?: T;
  error?: { message?: string; __type?: string };
}

export interface CkanPackage {
  id: string;
  name: string;
  title: string;
  notes?: string | null;
  license_title?: string | null;
  license_url?: string | null;
  metadata_modified?: string;
  organization?: { name: string; title: string } | null;
  resources?: CkanResource[];
  tags?: Array<{ name: string }>;
}

interface CkanResource {
  id: string;
  name?: string | null;
  format?: string | null;
  url?: string | null;
  datastore_active?: boolean;
  description?: string | null;
  last_modified?: string | null;
}

interface DatastoreResult {
  total?: number;
  fields?: Array<{ id: string; type: string }>;
  records?: Array<Record<string, unknown>>;
}

const DATASET_ID = /^[a-z0-9][a-z0-9_-]{1,99}$/;
const RESOURCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function unwrap<T>(body: CkanEnvelope<T>, portal: string): T {
  if (body.success && body.result !== undefined) return body.result;
  const message = body.error?.message ?? "unknown error";
  if (body.error?.__type?.includes("Not Found")) throw new ToolError("NOT_FOUND", `${portal}: ${message}`);
  throw new ToolError("BAD_ARGS", `${portal} rejected the request: ${message}`.slice(0, 300));
}

function clip(text: string | null | undefined, max: number): string {
  if (!text) return "";
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function createCkanModule(config: CkanConfig): SourceModule {
  const { info, prefix, portal, site } = config;
  const api = `${site}/api/3/action`;
  const ttl = config.ttlMs ?? HOUR;
  const datasetUrl = (name: string) => `${site}/dataset/${name}`;
  const ex = config.examples ?? DEFAULT_EXAMPLES;

  const summarise = (p: CkanPackage) => ({
    id: p.name,
    title: p.title,
    publisher: p.organization?.title ?? null,
    licence: p.license_title ?? null,
    modified: p.metadata_modified ?? null,
    formats: [...new Set((p.resources ?? []).map((r) => (r.format ?? "").toUpperCase()).filter(Boolean))],
    description: clip(p.notes, 280),
    url: datasetUrl(p.name)
  });

  async function packageSearch(ctx: ToolContext, params: Record<string, string>) {
    const url = `${api}/package_search?${new URLSearchParams(params).toString()}`;
    const result = await ctx.cachedJson<CkanEnvelope<{ count: number; results: CkanPackage[] }>>(url, ttl, { label: portal });
    return { url, value: unwrap(result.value, portal), cached: result.cached, stale: result.stale };
  }

  async function packageShow(ctx: ToolContext, id: string) {
    if (!DATASET_ID.test(id)) throw new ToolError("BAD_ARGS", `Dataset id must be the dataset's URL name, e.g. '${ex.dataset}'.`);
    const url = `${api}/package_show?id=${encodeURIComponent(id)}`;
    const result = await ctx.cachedJson<CkanEnvelope<CkanPackage>>(url, ttl, { label: portal });
    return { url, value: unwrap(result.value, portal), cached: result.cached, stale: result.stale };
  }

  const searchTool = defineTool({
    name: `${prefix}_search_datasets`,
    title: `Search ${portal} datasets`,
    description: `Search ${portal} open-data catalogue (CKAN) by keywords; optionally filter by publisher organisation slug or file format.`,
    inputSchema: {
      query: z.string().min(1).max(200).describe(`Keywords, e.g. ${ex.query}.`),
      organization: z.string().regex(/^[a-z0-9_-]+$/).max(100).optional().describe(`Publisher slug, e.g. '${ex.organization}'.`),
      format: z.string().regex(/^[A-Za-z0-9.+-]+$/).max(20).optional().describe("Resource format, e.g. CSV, GeoJSON, API."),
      limit: z.number().int().min(1).max(MAX_LIMIT).default(20)
    },
    handler: async ({ query, organization, format, limit }, ctx) => {
      const fq = [organization ? `organization:${organization}` : "", format ? `res_format:"${format}"` : ""].filter(Boolean).join(" AND ");
      const result = await packageSearch(ctx, { q: query, rows: String(Math.min(limit, 1000)), ...(fq ? { fq } : {}) });
      const { items, truncated } = bound(result.value.results.map(summarise), limit);
      return envelope(info, {
        data: { total: result.value.count, datasets: items },
        url: `${site}/dataset?q=${encodeURIComponent(query)}`,
        cached: result.cached,
        stale: result.stale,
        truncated: truncated || result.value.count > items.length
      });
    }
  });

  const getTool = defineTool({
    name: `${prefix}_get_dataset`,
    title: `Get a ${portal} dataset`,
    description: `Get one ${portal} dataset's description, licence and downloadable resources. Resources with datastore=true can be queried with ${prefix}_query_datastore.`,
    inputSchema: { id: z.string().min(2).max(100).describe(`Dataset URL name from search, e.g. '${ex.dataset}'.`) },
    handler: async ({ id }, ctx) => {
      const result = await packageShow(ctx, id);
      const p = result.value;
      return envelope(info, {
        data: {
          ...summarise(p),
          description: clip(p.notes, 2000),
          licence_url: p.license_url ?? null,
          tags: (p.tags ?? []).map((t) => t.name),
          resources: (p.resources ?? []).map((r) => ({
            id: r.id,
            name: r.name ?? null,
            format: r.format ?? null,
            url: r.url ?? null,
            datastore: Boolean(r.datastore_active),
            last_modified: r.last_modified ?? null
          }))
        },
        url: datasetUrl(p.name),
        cached: result.cached,
        stale: result.stale
      });
    }
  });

  const datastoreTool = defineTool({
    name: `${prefix}_query_datastore`,
    example: { resource_id: "330d9b75-0e85-4c95-b948-58b86acaa577", limit: 5 },
    title: `Query a ${portal} table`,
    description: `Read rows from a ${portal} resource that has a CKAN datastore (datastore=true in ${prefix}_get_dataset). Supports full-text 'q' and exact-match column filters.`,
    inputSchema: {
      resource_id: z.string().regex(RESOURCE_ID).describe("Resource UUID from the dataset's resources."),
      q: z.string().max(200).optional().describe("Full-text search across the table."),
      filters: z.record(z.string().max(100), z.union([z.string().max(200), z.number(), z.boolean()])).optional().describe("Exact-match filters, e.g. {\"Year\": 2025}."),
      offset: z.number().int().min(0).max(1_000_000).default(0),
      limit: z.number().int().min(1).max(MAX_LIMIT).default(50)
    },
    handler: async ({ resource_id, q, filters, offset, limit }, ctx) => {
      const params = new URLSearchParams({ resource_id, limit: String(limit), offset: String(offset) });
      if (q) params.set("q", q);
      if (filters && Object.keys(filters).length) params.set("filters", JSON.stringify(filters));
      const url = `${api}/datastore_search?${params.toString()}`;
      const result = await ctx.cachedJson<CkanEnvelope<DatastoreResult>>(url, ttl, { label: portal });
      const value = unwrap(result.value, portal);
      const records = value.records ?? [];
      return envelope(info, {
        data: {
          total: value.total ?? null,
          fields: (value.fields ?? []).filter((f) => f.id !== "_id").map((f) => ({ name: f.id, type: f.type })),
          records
        },
        url,
        cached: result.cached,
        stale: result.stale,
        truncated: (value.total ?? 0) > offset + records.length
      });
    }
  });

  return {
    info,
    summary: config.summary,
    domain: config.domain,
    coverage: config.coverage,
    tools: [searchTool, getTool, datastoreTool],
    async search(query, max, ctx) {
      const result = await packageSearch(ctx, { q: query, rows: String(max) });
      return result.value.results.map((p) => ({ id: `${info.id}:${p.name}`, title: `${p.title} (${portal})`, url: datasetUrl(p.name) }));
    },
    async fetchById(key, ctx) {
      const { value: p } = await packageShow(ctx, key);
      const text = [
        p.title,
        p.organization?.title ? `Publisher: ${p.organization.title}` : "",
        p.license_title ? `Licence: ${p.license_title}` : "",
        p.metadata_modified ? `Modified: ${p.metadata_modified}` : "",
        "",
        clip(p.notes, 4000),
        "",
        "Resources:",
        ...(p.resources ?? []).map((r) => `- ${r.name ?? r.id} [${r.format ?? "?"}]${r.datastore_active ? " (queryable)" : ""}: ${r.url ?? ""}`)
      ]
        .filter((line, i, all) => line !== "" || all[i - 1] !== "")
        .join("\n");
      return {
        id: `${info.id}:${p.name}`,
        title: p.title,
        text,
        url: datasetUrl(p.name),
        metadata: { source: info.id, publisher: p.organization?.title ?? null, licence: p.license_title ?? null, modified: p.metadata_modified ?? null }
      };
    }
  };
}
