import { readFileSync } from "node:fs";
import { z } from "zod";

/**
 * The CIB snapshots live in web/data/cib/ so the public site, the npm package and the Functions app
 * read one file. From src/sources/cib/ (tests) and dist/src/sources/cib/ (build) the same relative path
 * reaches web/data/ in the repository or dist/web/data/ (copied by scripts/copy-assets.mjs).
 */
export const CIB_DATA_DIR = new URL("../../../web/data/cib/", import.meta.url);
export const CIB_FILES = { annual: "cis-annual.json", categories: "cis-query-categories.json", cips: "cips.json" } as const;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const officialUrl = z.string().url().refine((u) => new URL(u).hostname === "www.citizensinformationboard.ie" && u.startsWith("https://"), "must be an https CIB URL");
const printedFigure = z.object({ value: z.number().int().nonnegative(), printed: z.string().min(1), source: z.string().min(1) }).strict();

const common = {
  schema_version: z.literal(1),
  dataset: z.string(),
  title: z.string().min(1),
  publisher: z.literal("Citizens Information Board"),
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  licence: z.object({
    name: z.string().min(1),
    url: z.string().url(),
    notice_url: officialUrl,
    attribution: z.string().min(1),
    credit: z.string().min(1)
  }).strict(),
  data_hub_url: officialUrl,
  sources: z.array(z.object({
    id: z.string().min(1), url: officialUrl, page_url: officialUrl, format: z.enum(["docx", "html"]),
    description: z.string().min(1), sha256, bytes: z.number().int().positive()
  }).strict()).min(2),
  notes: z.array(z.string().min(1))
};

const quarter = z.object({ quarter: z.number().int().min(1).max(4), callers: printedFigure }).strict();
export const annualSchema = z.object({
  ...common,
  dataset: z.literal("cib-cis-annual"),
  years: z.array(z.object({
    year: z.number().int(),
    queries: printedFigure,
    callers: z.union([
      printedFigure.extend({ derived: z.literal(false) }).strict(),
      z.object({ value: z.number().int().positive(), printed: z.null(), source: z.null(), derived: z.literal(true), method: z.string().min(1) }).strict()
    ]),
    quarterly_callers: z.array(quarter).length(4).optional()
  }).strict()).min(1)
}).strict();

const categoryRow = z.object({ category: z.string().min(1), source_label: z.string().min(1), queries: printedFigure, share_percent: z.number().nullable() }).strict();
export const categoriesSchema = z.object({
  ...common,
  dataset: z.literal("cib-cis-query-categories"),
  years: z.array(z.object({
    year: z.number().int(), source: z.string(), table: z.string(), total_queries: printedFigure,
    categories: z.array(categoryRow).min(1), sum_of_categories: z.number().int(), matches_total: z.boolean()
  }).strict()).min(1)
}).strict();

const cipsCategory = z.object({
  category: z.string().min(1), source_label: z.string().min(1), calls: printedFigure, share_percent: z.number().nullable(),
  subcategory_table_total: printedFigure.extend({ table: z.string() }).strict().optional(),
  note: z.string().optional()
}).strict();
export const cipsSchema = z.object({
  ...common,
  dataset: z.literal("cib-cips"),
  years: z.array(z.object({
    year: z.number().int(), source: z.string(),
    contacts: z.object({
      telephone: printedFigure, webchat: printedFigure, social_media: printedFigure,
      total: printedFigure.extend({ basis: z.enum(["table", "text"]) }).strict()
    }).strict(),
    categorised_calls: printedFigure,
    categories: z.array(cipsCategory).min(1),
    sum_of_categories: z.number().int(), matches_total: z.boolean(), notes: z.array(z.string())
  }).strict()).min(1)
}).strict();

export type AnnualSnapshot = z.infer<typeof annualSchema>;
export type CategoriesSnapshot = z.infer<typeof categoriesSchema>;
export type CipsSnapshot = z.infer<typeof cipsSchema>;
export interface CibSnapshots { annual: AnnualSnapshot; categories: CategoriesSnapshot; cips: CipsSnapshot }

/** Validates a parsed snapshot: schema, and every cited source id must be listed in `sources`. */
export function validateSnapshot<T>(json: unknown, schema: z.ZodType<T>, file: string): T {
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new Error(`${file} failed validation: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const doc = parsed.data as { sources: Array<{ id: string }>; years: unknown[] };
  const ids = new Set(doc.sources.map((s) => s.id));
  const missing = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const source = (node as { source?: unknown }).source;
    if (typeof source === "string" && !ids.has(source)) missing.add(source);
    Object.values(node).forEach(walk);
  };
  walk(doc.years);
  if (missing.size) throw new Error(`${file} cites sources that are not listed: ${[...missing].join(", ")}`);
  return parsed.data;
}

/** Reads and validates one snapshot file. Throws with the file name when the file is missing or malformed. */
export function readSnapshot<T>(file: string, schema: z.ZodType<T>, dir: URL = CIB_DATA_DIR): T {
  return validateSnapshot(JSON.parse(readFileSync(new URL(file, dir), "utf8")), schema, file);
}

export function loadCibSnapshots(dir: URL = CIB_DATA_DIR): CibSnapshots {
  return {
    annual: readSnapshot(CIB_FILES.annual, annualSchema, dir),
    categories: readSnapshot(CIB_FILES.categories, categoriesSchema, dir),
    cips: readSnapshot(CIB_FILES.cips, cipsSchema, dir)
  };
}
