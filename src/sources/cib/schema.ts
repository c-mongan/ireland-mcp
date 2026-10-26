import { z } from "zod";

export const CIB_LICENCE = "CC BY 4.0";
export const CIB_LICENCE_URL = "https://creativecommons.org/licenses/by/4.0/";
export const CIB_PSI_NOTICE = "https://www.citizensinformationboard.ie/en/notices/psi.html";
export const CIB_ATTRIBUTION = "Contains Irish Public Sector Data licensed under a Creative Commons Attribution 4.0 International (CC BY 4.0) licence. Source: Citizens Information Board, Data Hub statistical reports.";

const ALIASES: Record<string, string> = { "birth-family-and-relationship": "birth-family-and-relationships", covid19: "covid-19" };
/** Stable comparison key for a published category label. */
export function categoryKey(label: string): string {
  const key = label.toLocaleLowerCase("en").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return ALIASES[key] ?? key;
}

const sourceFile = z.object({
  url: z.string().url().startsWith("https://www.citizensinformationboard.ie/"),
  role: z.string(),
  format: z.enum(["docx", "pdf", "html"]),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().positive(),
  retrieved_at: z.string().datetime()
});
const checkResult = z.object({ name: z.string(), ok: z.boolean(), detail: z.string() });
const count = z.number().int().nonnegative();
const share = z.number().nullable();
const year = z.number().int().min(2000).max(2100);

const cisAnnual = z.object({
  year, callers: count, callers_basis: z.enum(["published_annual_summary", "derived_sum_of_quarterly_reports"]),
  callers_derivation: z.object({ formula: z.string(), operands: z.array(z.object({ label: z.string(), value: count, url: z.string().url() })).length(4), warning: z.string() }).optional(),
  queries: count, queries_per_caller_published: z.number().positive(), queries_per_caller_computed: z.number().positive(),
  sources: z.array(sourceFile).min(1), checks: z.array(checkResult)
});
const cisCategory = z.object({
  year, total_queries: count,
  categories: z.array(z.object({ category: z.string().min(1), category_key: z.string().min(1), queries: count, share_pct_published: share })).min(1),
  sources: z.array(sourceFile).min(1), checks: z.array(checkResult)
});
const cips = z.object({
  year,
  contacts: z.object({ telephone: count, webchat: count, social_media: count, total: count }),
  calls_answered_published: count, calls_answered_published_text: z.string().min(1),
  calls_answered_basis: z.enum(["all_contact_modes", "telephone_only", "unclear"]),
  comparability_note: z.string(),
  categorised_calls_total: count,
  categories: z.array(z.object({ category: z.string().min(1), category_key: z.string().min(1), calls: count, share_pct_published: share })).min(1),
  sources: z.array(sourceFile).min(1), checks: z.array(checkResult)
});

const datasetOf = <T extends z.ZodTypeAny>(record: T) => z.object({
  schema: z.string(), title: z.string(), description: z.string(), publisher: z.literal("Citizens Information Board"),
  landing_page: z.string().url(), licence: z.literal(CIB_LICENCE), licence_url: z.string().url(), reuse_notice: z.string().url(),
  attribution: z.string().min(1), as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), generated_by: z.string(),
  notes: z.array(z.string()), records: z.array(record).min(1)
});
export const cisAnnualDataset = datasetOf(cisAnnual);
export const cisCategoryDataset = datasetOf(cisCategory);
export const cipsDataset = datasetOf(cips);

export type SourceFile = z.infer<typeof sourceFile>;
export type CheckResult = z.infer<typeof checkResult>;
export type CisAnnualRecord = z.infer<typeof cisAnnual>;
export type CisCategoryRecord = z.infer<typeof cisCategory>;
export type CipsRecord = z.infer<typeof cips>;
export interface CibDataset<T> extends Omit<z.infer<ReturnType<typeof datasetOf>>, "records" | "publisher" | "licence"> {
  publisher: "Citizens Information Board"; licence: typeof CIB_LICENCE; records: T[];
}
