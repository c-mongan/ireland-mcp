import { readFileSync } from "node:fs";
import { z } from "zod";
import { envelope, MAX_LIMIT, type SourceInfo } from "../../gateway/envelope.js";
import { ToolError } from "../../gateway/errors.js";
import { defineTool, type FetchedDocument, type SearchHit, type SourceModule, type ToolContext } from "../../gateway/module.js";
import { DATA_PAGE, type Snapshot } from "./export.js";

export const kohesioInfo: SourceInfo = {
  id: "kohesio", name: "Kohesio EU-funded projects",
  licence: "European Commission reuse policy / CC BY 4.0 compatible",
  attribution: "European Commission, Kohesio platform. Dated Irish country exports; not live data.",
  homepage: "https://kohesio.ec.europa.eu/"
};

// Packaged with the deployment. Hosted requests never call the rate-limited frontend API.
let snapshot: Snapshot | undefined;
function load(): Snapshot {
  snapshot ??= JSON.parse(readFileSync(new URL("./snapshot.json", import.meta.url), "utf8")) as Snapshot;
  return snapshot;
}
function projectId(idOrUrl: string): string {
  const id = idOrUrl.trim();
  if (/^Q\d+$/.test(id)) return id;
  if (/^https:\/\/linkedopendata\.eu\/entity\/Q\d+$/.test(id)) return id.split("/").pop()!;
  throw new ToolError("BAD_ARGS", "Project id must be a Kohesio Q id, e.g. Q232198, or its linkedopendata.eu URL.");
}
function getProject(id: string) {
  const key = projectId(id);
  const project = load().projects.find((p) => p.id === key);
  if (!project) throw new ToolError("NOT_FOUND", "Project is not present in the packaged Irish Kohesio exports.", {
    hint: "This is a dated snapshot, not a live or exhaustive project lookup. Check the Kohesio website for newer records or Interreg projects."
  });
  return project;
}
function searchProjects(query = "", region = "", minBudget?: number) {
  const q = query.trim().toLocaleLowerCase("en");
  const r = region.trim().toLocaleLowerCase("en");
  return load().projects.filter((p) =>
    (!q || [p.title, p.description, p.locality, ...p.regions, ...p.beneficiaries.map((b) => b.name), ...p.funds.map((f) => f.label)].join(" ").toLocaleLowerCase("en").includes(q)) &&
    (!r || p.regions.some((v) => v.toLocaleLowerCase("en").includes(r))) &&
    (minBudget === undefined || (p.eu_budget !== null && p.eu_budget >= minBudget))
  );
}
const snapshotMetadata = () => ({ ...load().metadata, exports: load().metadata.exports.map(({ columns: _columns, ...e }) => e) });
const evidence = () => ({ url: DATA_PAGE, cached: true, retrievedAt: new Date(load().metadata.exports[0]!.retrieved_at) });

const searchTool = defineTool({
  name: "kohesio_search_projects", title: "Search EU-funded Irish projects",
  description: "Search a dated snapshot of the official Kohesio Ireland CSV exports by keyword, region name/code or minimum EU budget. Not live data; excludes separate Interreg exports.",
  example: { query: "Galway", limit: 5 },
  inputSchema: {
    query: z.string().max(120).optional().describe("Case-insensitive text in title, summary, locality, regions, fund or beneficiary."),
    region: z.string().max(100).optional().describe("Case-insensitive NUTS region name or code in the export."),
    min_eu_budget: z.number().nonnegative().optional(),
    limit: z.number().int().min(1).max(MAX_LIMIT).default(10),
    offset: z.number().int().min(0).max(100_000).default(0)
  },
  handler: async ({ query, region, min_eu_budget, limit, offset }) => {
    const matches = searchProjects(query, region, min_eu_budget);
    const projects = matches.slice(offset, offset + limit);
    return envelope(kohesioInfo, { ...evidence(), data: { total: matches.length, projects, offset,
      next_offset: offset + projects.length < matches.length ? offset + projects.length : null,
      snapshot: snapshotMetadata() }, truncated: offset + projects.length < matches.length });
  }
});
const getTool = defineTool({
  name: "kohesio_get_project", title: "Get a Kohesio project",
  description: "Get an Irish project by Q id from the packaged official Kohesio CSV snapshot. Not a live lookup.",
  example: { id: "Q232198" },
  inputSchema: { id: z.string().min(2).max(120).describe("Kohesio Q id or linkedopendata.eu entity URL.") },
  handler: async ({ id }) => envelope(kohesioInfo, { ...evidence(), data: { ...getProject(id), snapshot: snapshotMetadata() } })
});
export const kohesioModule: SourceModule = {
  info: kohesioInfo,
  summary: "EU cohesion-funded Irish projects from dated official European Commission Kohesio CSV exports; not live data.",
  domain: "economy",
  coverage: "Packaged Irish country exports for 2014–2020 and 2021–2027. Snapshot dates and download attribution returned with results; excludes separate Interreg exports.",
  tools: [searchTool, getTool],
  async search(query: string, limit: number, _ctx: ToolContext): Promise<SearchHit[]> {
    return searchProjects(query).slice(0, Math.min(MAX_LIMIT, Math.max(1, limit))).map((p) => ({
      id: `kohesio:${p.id}`, title: `${p.title} [Kohesio snapshot ${load().metadata.exports.find((e) => e.programming_period === p.programming_period)!.snapshot_date}]`, url: p.url
    }));
  },
  async fetchById(key: string, _ctx: ToolContext): Promise<FetchedDocument> {
    const p = getProject(key.replace(/^project:/, ""));
    return { id: `kohesio:${p.id}`, title: p.title, text: JSON.stringify({ ...p, snapshot: snapshotMetadata() }, null, 2),
      url: p.url, metadata: { source: kohesioInfo.id, attribution: kohesioInfo.attribution, snapshot: snapshotMetadata() } };
  }
};
