import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { envelope, type SourceInfo } from "../../gateway/envelope.js";
import { ToolError } from "../../gateway/errors.js";
import { defineTool, type FetchedDocument, type SearchHit, type SourceModule, type ToolContext } from "../../gateway/module.js";
import { DIRECTORY_REPO, LISTING_LABEL, VERIFICATION, directorySnapshot, type DirectoryProject, type DirectorySnapshot } from "./parse.js";

export const civicDirectoryInfo: SourceInfo = {
  id: "civic-directory", name: "Éire Civic Tech Directory (CitizenData.ie)",
  licence: "MIT (directory catalogue)",
  attribution: "Éire Civic Tech Directory by William Kennedy (MIT licence), the catalogue behind CitizenData.ie. Project names, descriptions and links belong to the listed owners; status and links are as listed, unverified.",
  homepage: "https://citizendata.ie/"
};
export const DIRECTORY_PUBLIC_FILE = "https://irishopendata.ie/data/civic-directory.json";

// Resolves to web/data from src and to dist/web/data from the build (scripts/copy-assets.mjs).
let loaded: { data: DirectorySnapshot; sha256: string } | undefined;
function load() {
  if (!loaded) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(new URL("../../../web/data/civic-directory.json", import.meta.url));
    } catch {
      throw new ToolError("UPSTREAM_DOWN", "The packaged civic directory snapshot is missing.");
    }
    const parsed = directorySnapshot.safeParse(JSON.parse(bytes.toString("utf8")));
    if (!parsed.success) throw new ToolError("UPSTREAM_DOWN", "The packaged civic directory snapshot failed validation.");
    loaded = { data: parsed.data, sha256: createHash("sha256").update(bytes).digest("hex") };
  }
  return loaded;
}

export function snapshotHealth(): { ok: true; note: string } | { ok: false; error: string } {
  try {
    const { data } = load();
    return { ok: true, note: `packaged directory snapshot ${data.commit.slice(0, 7)}, ${data.projects.length} projects` };
  } catch {
    return { ok: false, error: "civic directory snapshot unreadable or invalid" };
  }
}

const fold = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("en").trim();
function present(p: DirectoryProject) {
  return {
    slug: p.slug, title: p.title, category: p.category, owners: p.owners, description: p.description,
    status_as_listed: p.status_as_listed, founding_year: p.founding_year,
    project_link: { url: p.link, note: VERIFICATION },
    ...(p.repo ? { repository: { url: p.repo, note: VERIFICATION } } : {}),
    citizendata_listing: { url: p.citizendata_listing_url, label: LISTING_LABEL },
    source: { url: p.source_url, sha256: p.sha256 }
  };
}
function snapshotMeta() {
  const { data, sha256 } = load();
  return {
    repository: data.repository, commit: data.commit, commit_date: data.commit_date, as_of: data.as_of,
    public_file: DIRECTORY_PUBLIC_FILE, file_sha256: sha256, licence: data.licence, licence_url: data.licence_url,
    listing_site: data.listing_site, listing_note: data.listing_note, verification: data.verification
  };
}
interface Filters { query?: string; category?: string; status?: "active" | "inactive" | "any"; owner?: string }
function matches({ query, category, status = "any", owner }: Filters): DirectoryProject[] {
  const q = fold(query ?? "");
  const c = fold(category ?? "");
  const o = fold(owner ?? "");
  return load().data.projects
    .filter((p) => (!q || fold([p.title, p.description, p.category, ...p.owners].join(" ")).includes(q)) &&
      (!c || fold(p.category) === c) &&
      (status === "any" || p.status_as_listed === status) &&
      (!o || p.owners.some((name) => fold(name).includes(o))))
    .sort((a, b) => a.title.localeCompare(b.title, "en") || a.slug.localeCompare(b.slug, "en"));
}

const searchTool = defineTool({
  name: "civic_directory_search", title: "Search Irish civic-tech projects",
  description: "Find Irish civic-tech projects listed in the Éire Civic Tech Directory (CitizenData.ie) by text, category, owner or listed status. Returns each project's own link and its CitizenData.ie listing. Pinned snapshot; status and links are as listed, unverified.",
  example: { query: "housing", limit: 5 },
  inputSchema: {
    query: z.string().max(120).optional().describe("Case-insensitive text in title, description, category or owner."),
    category: z.string().max(80).optional().describe("Exact category, e.g. Housing, Transport, Democracy. Case-insensitive."),
    owner: z.string().max(120).optional().describe("Case-insensitive part of an owner name."),
    status: z.enum(["active", "inactive", "any"]).default("any").describe("Status as listed by the directory; not verified."),
    limit: z.number().int().min(1).max(50).default(10),
    offset: z.number().int().min(0).max(10_000).default(0)
  },
  handler: async ({ query, category, owner, status, limit, offset }) => {
    const all = matches({ query, category, owner, status });
    const page = all.slice(offset, offset + limit);
    const { data } = load();
    return envelope(civicDirectoryInfo, {
      url: `${DIRECTORY_REPO}/tree/${data.commit}`, cached: true, retrievedAt: new Date(`${data.as_of}T00:00:00Z`),
      truncated: offset + page.length < all.length,
      data: {
        total: all.length, offset, next_offset: offset + page.length < all.length ? offset + page.length : null,
        projects: page.map(present),
        categories: [...new Set(data.projects.map((p) => p.category))].sort(),
        snapshot: snapshotMeta()
      }
    });
  }
});

function getProject(slug: string): DirectoryProject {
  const project = load().data.projects.find((p) => p.slug === slug);
  if (!project) throw new ToolError("NOT_FOUND", "Project is not in the packaged directory snapshot.", { hint: "Use civic_directory_search to find a project slug." });
  return project;
}

export const civicDirectoryModule: SourceModule = {
  info: civicDirectoryInfo,
  summary: "Discovery index of Irish civic-tech projects from the MIT-licensed Éire Civic Tech Directory behind CitizenData.ie; links to each project and its CitizenData.ie listing.",
  domain: "law/politics",
  coverage: "All directory entries at one pinned commit, with per-entry SHA-256. Status, owners and links are as listed, unverified. citizendata.ie is never fetched. Also published as JSON at https://irishopendata.ie/data/civic-directory.json.",
  tools: [searchTool],
  async search(query: string, limit: number, _ctx: ToolContext): Promise<SearchHit[]> {
    return matches({ query }).slice(0, Math.min(50, Math.max(1, limit))).map((p) => ({
      id: `civic-directory:${p.slug}`, title: `${p.title} [civic-tech directory, as listed]`, url: p.citizendata_listing_url
    }));
  },
  async fetchById(key: string, _ctx: ToolContext): Promise<FetchedDocument> {
    const p = getProject(key.replace(/^project:/, ""));
    return {
      id: `civic-directory:${p.slug}`, title: p.title, url: p.citizendata_listing_url,
      text: JSON.stringify({ ...present(p), snapshot: snapshotMeta() }, null, 2),
      metadata: { source: civicDirectoryInfo.id, attribution: civicDirectoryInfo.attribution, licence: civicDirectoryInfo.licence }
    };
  }
};
