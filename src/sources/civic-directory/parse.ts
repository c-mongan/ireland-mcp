import { z } from "zod";

export const DIRECTORY_REPO = "https://github.com/williamkennedy/eire_civic_tech_directory";
export const DIRECTORY_RAW = "https://raw.githubusercontent.com/williamkennedy/eire_civic_tech_directory";
export const PROJECTS_PATH = "src/content/projects";
export const CITIZENDATA = "https://citizendata.ie";
export const LISTING_LABEL = "see listing on CitizenData.ie";
export const VERIFICATION = "as listed, unverified";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const webUrl = z.string().max(500).url().refine((u) => /^https?:\/\//i.test(u), "must be an http(s) URL");
const text = (max: number) => z.string().trim().min(1).max(max);

export const directoryProject = z.object({
  slug: z.string().regex(SLUG).max(120),
  title: text(200),
  category: text(80),
  owners: z.array(text(200)).min(1).max(20),
  description: text(1000),
  status_as_listed: z.enum(["active", "inactive"]),
  founding_year: z.number().int().min(1900).max(2100).nullable(),
  link: webUrl,
  repo: webUrl.nullable(),
  citizendata_listing_url: z.string().url().startsWith(`${CITIZENDATA}/project/`),
  source_url: z.string().url().startsWith(`${DIRECTORY_REPO}/blob/`),
  sha256: z.string().regex(/^[0-9a-f]{64}$/)
});
export type DirectoryProject = z.infer<typeof directoryProject>;

export const directorySnapshot = z.object({
  schema: z.string(), title: z.string(), description: z.string(),
  publisher: z.string(), maintainer: z.string(), repository: z.literal(DIRECTORY_REPO),
  commit: z.string().regex(/^[0-9a-f]{40}$/), commit_date: z.string().datetime({ offset: true }),
  licence: z.literal("MIT"), licence_url: z.string().url(), licence_text: z.string().min(100), licence_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  attribution: z.string().min(1), listing_site: z.literal(`${CITIZENDATA}/`), listing_note: z.string(), verification: z.string(),
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), generated_by: z.string(),
  projects: z.array(directoryProject).min(1).max(2000)
});
export type DirectorySnapshot = z.infer<typeof directorySnapshot>;

const ALLOWED = new Set(["title", "category", "owner", "description", "status", "link", "repo", "foundingYear"]);
const REQUIRED = ["title", "category", "owner", "description", "status", "link"];

/**
 * Parses one directory entry's frontmatter with a deliberately strict subset of YAML:
 * one optional UTF-8 BOM, `key: value` lines, a JSON-style owner array and plain scalars.
 * Anything else (quoting, multi-line values, unknown or duplicate keys) is rejected.
 */
export function parseEntry(slug: string, markdown: string, meta: { sourceUrl: string; sha256: string }): DirectoryProject {
  const fail = (why: string): never => { throw new Error(`${slug}.md: ${why}`); };
  if (!SLUG.test(slug)) fail("file name is not a lowercase slug");
  const body = (markdown.startsWith("\uFEFF") ? markdown.slice(1) : markdown).replace(/\r\n/g, "\n");
  const m = body.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!m) fail("no frontmatter block");
  const fields = new Map<string, string>();
  for (const line of m![1]!.split("\n")) {
    if (!line.trim()) continue;
    const kv = line.match(/^([A-Za-z]+):[ \t]*(.*)$/);
    if (!kv) fail(`unsupported frontmatter line: ${line.slice(0, 60)}`);
    const [, key, raw] = kv!;
    if (!ALLOWED.has(key!)) fail(`unknown field ${key}`);
    if (fields.has(key!)) fail(`duplicate field ${key}`);
    const value = raw!.trim();
    if (key !== "owner" && (/^["'[{|>&*!%@`#]/.test(value) || /\s#|:\s/.test(value))) fail(`unsupported YAML syntax in ${key}`);
    fields.set(key!, value);
  }
  for (const key of REQUIRED) if (!fields.get(key)) fail(`missing ${key}`);
  let owners: unknown;
  try { owners = JSON.parse(fields.get("owner")!); } catch { fail("owner is not a JSON-style string array"); }
  if (!Array.isArray(owners) || !owners.every((o) => typeof o === "string")) fail("owner is not a string array");
  const status = fields.get("status");
  if (status !== "true" && status !== "false") fail("status is not true or false");
  const year = fields.get("foundingYear");
  if (year !== undefined && !/^\d{4}$/.test(year)) fail("foundingYear is not a four-digit year");
  const parsed = directoryProject.safeParse({
    slug, title: fields.get("title"), category: fields.get("category"), owners, description: fields.get("description"),
    status_as_listed: status === "true" ? "active" : "inactive", founding_year: year ? Number(year) : null,
    link: fields.get("link"), repo: fields.get("repo") ?? null,
    citizendata_listing_url: `${CITIZENDATA}/project/${encodeURIComponent(slug)}`,
    source_url: meta.sourceUrl, sha256: meta.sha256
  });
  if (!parsed.success) fail(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return parsed.data!;
}
