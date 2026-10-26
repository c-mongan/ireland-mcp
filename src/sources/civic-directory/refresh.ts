import { createHash } from "node:crypto";
import { HttpClient } from "../../gateway/http.js";
import {
  CITIZENDATA, DIRECTORY_RAW, DIRECTORY_SCHEMA, DIRECTORY_REPO, LISTING_LABEL, PROJECTS_PATH, VERIFICATION,
  directorySnapshot, parseEntry, type DirectorySnapshot
} from "./parse.js";

const API = "https://api.github.com/repos/williamkennedy/eire_civic_tech_directory";
const MAX_PROJECTS = 2000;
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
// Keep any byte-order mark so the parser sees the file exactly as committed.
const utf8 = (b: Uint8Array) => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(b);

/**
 * Maintenance only: never called by an MCP operation. Reads the MIT-licensed catalogue at one pinned
 * commit from GitHub. citizendata.ie itself is never fetched; its listing URLs are derived from slugs.
 */
export async function refreshDirectory(commit: string, http = new HttpClient(), now = new Date()): Promise<DirectorySnapshot> {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("Pass a full 40-character commit SHA.");
  const opts = (label: string) => ({ label, timeoutMs: 30_000, maxBytes: 2_000_000, retries: 1, headers: { accept: "application/vnd.github+json" } });
  const info = await http.json<{ sha?: string; commit?: { committer?: { date?: string } } }>(`${API}/commits/${commit}`, opts("Directory commit"));
  const commitDate = info.commit?.committer?.date;
  if (info.sha !== commit || !commitDate) throw new Error(`Commit ${commit} was not found.`);
  const tree = await http.json<{ truncated?: boolean; tree?: Array<{ path: string; type: string }> }>(`${API}/git/trees/${commit}?recursive=1`, opts("Directory tree"));
  if (tree.truncated || !Array.isArray(tree.tree)) throw new Error("GitHub returned an incomplete tree listing.");
  const files = tree.tree.filter((e) => e.type === "blob" && e.path.startsWith(`${PROJECTS_PATH}/`) && e.path.endsWith(".md"));
  if (!files.length || files.length > MAX_PROJECTS) throw new Error(`Unexpected project file count ${files.length}.`);
  const projects = [];
  for (const file of files) {
    const name = file.path.slice(PROJECTS_PATH.length + 1);
    if (name.includes("/")) throw new Error(`Nested project file ${file.path} is not supported.`);
    const bytes = await http.bytes(`${DIRECTORY_RAW}/${commit}/${file.path}`, { label: "Directory entry", timeoutMs: 30_000, maxBytes: 200_000, retries: 1 });
    projects.push(parseEntry(name.slice(0, -3), utf8(bytes), { sourceUrl: `${DIRECTORY_REPO}/blob/${commit}/${file.path}`, sha256: sha256(bytes) }));
  }
  const slugs = new Set(projects.map((p) => p.slug));
  if (slugs.size !== projects.length) throw new Error("Duplicate project slugs.");
  projects.sort((a, b) => a.slug.localeCompare(b.slug, "en"));
  const licenceBytes = await http.bytes(`${DIRECTORY_RAW}/${commit}/LICENSE`, { label: "Directory licence", timeoutMs: 30_000, maxBytes: 20_000, retries: 1 });
  const licence = utf8(licenceBytes);
  if (!/^MIT License/.test(licence.trim())) throw new Error("The pinned commit's LICENSE is not the MIT licence.");
  return directorySnapshot.parse({
    schema: DIRECTORY_SCHEMA,
    title: "Éire Civic Tech Directory snapshot",
    description: "Irish civic-tech projects as listed in the Éire Civic Tech Directory, which powers CitizenData.ie.",
    publisher: "Éire Civic Tech Directory (CitizenData.ie)", maintainer: "William Kennedy",
    repository: DIRECTORY_REPO, commit, commit_date: commitDate,
    licence: "MIT", licence_url: `${DIRECTORY_REPO}/blob/${commit}/LICENSE`, licence_text: licence.trim(), licence_sha256: sha256(licenceBytes),
    attribution: `Éire Civic Tech Directory by William Kennedy (MIT licence), the catalogue behind CitizenData.ie. Project names, descriptions and links belong to the listed owners.`,
    listing_site: `${CITIZENDATA}/`,
    listing_note: `citizendata_listing_url ("${LISTING_LABEL}") is derived from each entry's file name. Ireland MCP does not fetch or scrape citizendata.ie.`,
    verification: `Status, owners and links are ${VERIFICATION}. Ireland MCP has not checked whether projects are live or accurately described.`,
    as_of: now.toISOString().slice(0, 10), generated_at: now.toISOString(), generated_by: "scripts/refresh-civic-directory.mjs (https://github.com/c-mongan/ireland-mcp)",
    projects
  });
}
