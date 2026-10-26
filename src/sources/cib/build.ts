import { createHash } from "node:crypto";
import { docxBlocks, paragraphs, tables, type DocxBlock } from "./docx.js";
import type { CheckResult, CipsRecord, CisAnnualRecord, CisCategoryRecord, CibDataset, SourceFile } from "./schema.js";
import { CIB_ATTRIBUTION, CIB_LICENCE, CIB_LICENCE_URL, CIB_PSI_NOTICE, CIB_SCHEMA, categoryKey } from "./schema.js";

/** Maintenance only. Pinned official CIB files: the refresh downloads these and nothing else. */
export const CIB_ORIGIN = "https://www.citizensinformationboard.ie";
const D = `${CIB_ORIGIN}/downloads/datahub`;
const page = (year: number) => `${CIB_ORIGIN}/en/data-hub/cis-data-hub/${year}-statistical-summary/`;
export const CIS_HUB = `${CIB_ORIGIN}/en/data-hub/cis-data-hub/`;
export const CIPS_HUB = `${CIB_ORIGIN}/en/data-hub/cips-data-hub/`;

export interface CisPin { categories: string; callers: { page: string; pattern: RegExp } | { quarterly: string[] } }
export const CIS_PINS: Record<number, CisPin> = {
  2021: { categories: `${D}/query-categories2021`, callers: { page: page(2021), pattern: /([\d,]+) callers assisted by Citizens Information Services/ } },
  2022: { categories: `${D}/query-categories-2022`, callers: { page: page(2022), pattern: /([\d,]+) callers were assisted by the Citizen's Information Services/ } },
  2023: { categories: `${D}/query-categories-2023-v3`, callers: { page: page(2023), pattern: /([\d,]+) callers were assisted by Citizens Information Services/ } },
  2024: { categories: `${D}/query-categories-2024`, callers: { page: page(2024), pattern: /Citizens Information Services nationwide assisted ([\d,]+) callers/ } },
  2025: { categories: `${D}/query-categories-2025`, callers: { quarterly: [`${D}/q1-2025`, `${D}/Q2-2025-CIS-statistical-report`, `${D}/Q3-2025-CIS-statistical-report`, `${D}/Q4-2025-CIS-statistical-report`] } }
};
export const CIPS_PINS: Record<number, string> = {
  2021: `${D}/CIPS-statistical-summary-2021-1`,
  2022: `${D}/CIPS-statistical-summary-2022-1`,
  2023: `${D}/CIPS-statistical-summary-2023`,
  2024: `${D}/CIPS-statistical-summary-2024`,
  2025: `${D}/CIPS-statistical-summary-2025`
};

/** Every URL the refresh needs. DOCX editions are parsed; PDF editions and HTML pages are checksummed. */
export function pinnedUrls(): string[] {
  const urls = new Set<string>();
  for (const pin of Object.values(CIS_PINS)) {
    urls.add(`${pin.categories}.docx`).add(`${pin.categories}.pdf`);
    if ("page" in pin.callers) urls.add(pin.callers.page);
    else for (const q of pin.callers.quarterly) urls.add(`${q}.docx`).add(`${q}.pdf`);
  }
  for (const base of Object.values(CIPS_PINS)) urls.add(`${base}.docx`).add(`${base}.pdf`);
  return [...urls];
}

export interface Download { bytes: Uint8Array; retrievedAt: string }
export type Downloads = Map<string, Download>;

const formatOf = (url: string): SourceFile["format"] => (url.endsWith(".docx") ? "docx" : url.endsWith(".pdf") ? "pdf" : "html");
function sourceFile(downloads: Downloads, url: string, role: string): SourceFile {
  const d = downloads.get(url);
  if (!d) throw new Error(`Missing download for ${url}`);
  return { url, role, format: formatOf(url), sha256: createHash("sha256").update(d.bytes).digest("hex"), bytes: d.bytes.byteLength, retrieved_at: d.retrievedAt };
}
function blocksOf(downloads: Downloads, url: string): DocxBlock[] {
  const d = downloads.get(url);
  if (!d) throw new Error(`Missing download for ${url}`);
  return docxBlocks(d.bytes);
}

/** Parses a published whole number such as "1,789" or "315,200". */
export function count(cell: string | undefined): number | undefined {
  const s = cell?.trim() ?? "";
  return /^\d{1,3}(,\d{3})+$|^\d+$/.test(s) ? Number(s.replace(/,/g, "")) : undefined;
}
const pct = (cell: string | undefined) => {
  const m = cell?.trim().match(/^([+-]?\d+(?:\.\d+)?)\s*%?$/);
  return m ? Number(m[1]) : null;
};
function mustMatch(texts: string[], re: RegExp, what: string): RegExpMatchArray {
  for (const t of texts) { const m = t.match(re); if (m) return m; }
  throw new Error(`Could not find ${what} (${re}).`);
}
const htmlText = (bytes: Uint8Array) => Buffer.from(bytes).toString("utf8")
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")
  .replace(/&#39;|&rsquo;/g, "'").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
const check = (name: string, ok: boolean, detail: string): CheckResult => ({ name, ok, detail });

interface CategoryRow { category: string; category_key: string; count: number; share_pct_published: number | null }
/** Reads a published category table: label, count and the published share column. */
function categoryTable(rows: string[][], shareHeader: RegExp, totalLabel: RegExp) {
  const header = rows[0] ?? [];
  const shareColumn = header.findIndex((h) => shareHeader.test(h));
  if (shareColumn < 0) throw new Error(`Category table has no share column matching ${shareHeader}: ${header.join(" | ")}`);
  const categories: CategoryRow[] = [];
  let total: number | undefined;
  for (const row of rows.slice(1)) {
    const n = count(row[1]);
    if (n === undefined) continue;
    const label = row[0]!.trim();
    if (!label || totalLabel.test(label)) { total = n; continue; }
    categories.push({ category: label, category_key: categoryKey(label), count: n, share_pct_published: pct(row[shareColumn]) });
  }
  if (!categories.length || total === undefined) throw new Error("Category table has no rows or no total row.");
  return { categories, total };
}

export function buildCisRecords(downloads: Downloads, pins: Record<number, CisPin> = CIS_PINS) {
  const annual: CisAnnualRecord[] = [];
  const categories: CisCategoryRecord[] = [];
  for (const [yearKey, pin] of Object.entries(pins)) {
    const year = Number(yearKey);
    const docxUrl = `${pin.categories}.docx`;
    const blocks = blocksOf(downloads, docxUrl);
    const text = paragraphs(blocks);
    const queries = count(mustMatch(text, /([\d,]+) queries from the public/, `${year} CIS queries`)[1])!;
    const ratio = Number(mustMatch(text, /ratio of queries per caller was (\d+\.\d+)/, `${year} queries per caller`)[1]);
    const table = tables(blocks).find((t) => /categor/i.test(t[0]?.[0] ?? ""));
    if (!table) throw new Error(`${year}: CIS Table 1 not found.`);
    const { categories: rows, total } = categoryTable(table, /%\s*(of total|sub-category)/i, /^total$/i);
    const categorySources = [sourceFile(downloads, docxUrl, "query_categories_docx"), sourceFile(downloads, `${pin.categories}.pdf`, "query_categories_pdf")];
    const sum = rows.reduce((s, r) => s + r.count, 0);
    const categoryChecks = [
      check("categories_sum_to_table_total", sum === total, `sum ${sum}; published total ${total}`),
      check("table_total_matches_narrative", total === queries, `table ${total}; narrative ${queries}`)
    ];
    categories.push({ year, total_queries: total, categories: rows.map(({ count: n, ...r }) => ({ ...r, queries: n })), sources: categorySources, checks: categoryChecks });

    let callers: number;
    let basis: CisAnnualRecord["callers_basis"];
    let derivation: CisAnnualRecord["callers_derivation"];
    const callerSources: SourceFile[] = [];
    const callerChecks: CheckResult[] = [];
    if ("page" in pin.callers) {
      const d = downloads.get(pin.callers.page);
      if (!d) throw new Error(`Missing download for ${pin.callers.page}`);
      callers = count(mustMatch([htmlText(d.bytes)], pin.callers.pattern, `${year} CIS callers`)[1])!;
      basis = "published_annual_summary";
      callerSources.push(sourceFile(downloads, pin.callers.page, "annual_summary_page"));
    } else {
      const quarters = pin.callers.quarterly.map((q, i) => {
        const value = count(mustMatch(paragraphs(blocksOf(downloads, `${q}.docx`)), /([\d,]+) callers to CISs? nationally/, `${q} callers`)[1])!;
        callerSources.push(sourceFile(downloads, `${q}.docx`, "quarterly_report_docx"), sourceFile(downloads, `${q}.pdf`, "quarterly_report_pdf"));
        return { label: `Q${i + 1} ${year}`, value, url: `${q}.docx` };
      });
      callers = quarters.reduce((s, q) => s + q.value, 0);
      basis = "derived_sum_of_quarterly_reports";
      derivation = {
        formula: quarters.map((q) => q.label).join(" + "), operands: quarters,
        warning: `CIB has not published an annual ${year} callers figure. This is the sum of the four quarterly reports, not a published annual total.`
      };
      callerChecks.push(check("four_quarters_present", quarters.length === 4, `quarters ${quarters.map((q) => q.value).join(" + ")} = ${callers}`));
    }
    const computed = Math.round((queries / callers) * 100) / 100;
    callerChecks.push(check("published_ratio_matches_computed", Math.abs(computed - ratio) < 0.006, `published ${ratio}; computed ${computed}`));
    annual.push({
      year, callers, callers_basis: basis, ...(derivation ? { callers_derivation: derivation } : {}), queries, queries_per_caller_published: ratio, queries_per_caller_computed: computed,
      sources: [...callerSources, ...categorySources], checks: [...callerChecks, ...categoryChecks]
    });
  }
  return { annual, categories };
}

export function buildCipsRecords(downloads: Downloads, pins: Record<number, string> = CIPS_PINS): CipsRecord[] {
  return Object.entries(pins).map(([yearKey, base]) => {
    const year = Number(yearKey);
    const blocks = blocksOf(downloads, `${base}.docx`);
    const text = paragraphs(blocks);
    const answeredMatch = mustMatch(text, /There were ([\d,]+) calls answered by CIPS|CIPS answered ([\d,]+) calls during/, `${year} CIPS calls answered`);
    const answered = count(answeredMatch.slice(1).find(Boolean))!;
    const answeredText = text.find((t) => t.includes(answeredMatch[0]))!;
    const all = tables(blocks);
    const modeTable = all.find((t) => /caller type|mode of contact/i.test(t[0]?.[0] ?? ""));
    if (!modeTable) throw new Error(`${year}: CIPS mode table not found.`);
    const mode = (re: RegExp) => {
      const n = count(modeTable.find((r) => re.test(r[0] ?? ""))?.[1]);
      if (n === undefined) throw new Error(`${year}: CIPS mode ${re} not found.`);
      return n;
    };
    const contacts = { telephone: mode(/^telephone$/i), webchat: mode(/^web ?chats?$/i), social_media: mode(/^social media/i) };
    const total = contacts.telephone + contacts.webchat + contacts.social_media;
    const publishedTotal = count(modeTable.find((r) => /^total$/i.test(r[0] ?? ""))?.[1]);
    const basis: CipsRecord["calls_answered_basis"] = answered === total ? "all_contact_modes" : answered === contacts.telephone ? "telephone_only" : "unclear";
    const index = all.findIndex((t) => /main call(er)? category/i.test(t[0]?.[0] ?? ""));
    if (index < 0) throw new Error(`${year}: CIPS category table not found.`);
    const { categories, total: categorised } = categoryTable(all[index]!, /%\s*of (all|categorised)/i, /^total of categorised calls$/i);
    const sum = categories.reduce((s, r) => s + r.count, 0);
    const checks = [
      check("contact_modes_sum_to_published_total", publishedTotal === undefined || publishedTotal === total, `modes ${total}; published total ${publishedTotal ?? "not published"}`),
      check("calls_answered_basis_identified", basis !== "unclear", `calls answered ${answered}; telephone ${contacts.telephone}; all modes ${total}`),
      check("categories_sum_to_table_total", sum === categorised, `sum ${sum}; published total ${categorised}`)
    ];
    // The next five tables break down the five largest categories; each ends with a published total.
    const ranked = [...categories].sort((a, b) => b.count - a.count).slice(0, 5);
    const subtotals = all.slice(index + 1).map((t) => {
      const row = t.find((r) => r.some((c) => /^total\b/i.test(c)));
      return row ? row.map(count).find((n) => n !== undefined) : undefined;
    }).filter((n): n is number => n !== undefined).slice(0, 5);
    ranked.forEach((c, i) => {
      if (subtotals[i] !== undefined) checks.push(check(`subcategory_table_total_matches:${c.category_key}`, subtotals[i] === c.count, `main table ${c.count}; sub-category table total ${subtotals[i]}`));
    });
    return {
      year, contacts: { ...contacts, total }, calls_answered_published: answered, calls_answered_published_text: answeredText, calls_answered_basis: basis,
      comparability_note: basis === "telephone_only"
        ? "calls_answered_published counts telephone calls only (2024 onward definition). Compare years with contacts.total, not calls_answered_published."
        : basis === "all_contact_modes"
          ? "calls_answered_published counts telephone, webchat and social-media contacts (2021–2023 definition). Compare years with contacts.total, not calls_answered_published."
          : "The published calls-answered figure matches neither telephone calls nor all contacts. Use contacts.total.",
      categorised_calls_total: categorised, categories: categories.map(({ count: n, ...r }) => ({ ...r, calls: n })),
      sources: [sourceFile(downloads, `${base}.docx`, "annual_summary_docx"), sourceFile(downloads, `${base}.pdf`, "annual_summary_pdf")], checks
    };
  });
}

const COMMON_NOTES = [
  "National aggregates only. The Citizens Information Board publishes no county, local-office or CIS-company breakdown in these reports.",
  "Figures are transcribed from the official DOCX edition of each report. The matching PDF edition is checksummed alongside it.",
  "Published percentages are kept as printed and may not sum to exactly 100 because of rounding.",
  "Category labels vary between years, for example 'Birth, Family & Relationships' and 'Covid 19'. Use category_key to compare years."
];

function dataset<T>(kind: string, title: string, description: string, landing: string, notes: string[], records: T[], generatedAt: string): CibDataset<T> {
  return {
    schema: CIB_SCHEMA(kind), title, description,
    publisher: "Citizens Information Board", landing_page: landing,
    licence: CIB_LICENCE, licence_url: CIB_LICENCE_URL, reuse_notice: CIB_PSI_NOTICE, attribution: CIB_ATTRIBUTION,
    as_of: generatedAt.slice(0, 10), generated_at: generatedAt, generated_by: "scripts/refresh-cib.mjs (https://github.com/c-mongan/ireland-mcp)",
    notes, records
  };
}

/** Builds the three published datasets from already-downloaded official files. */
export function buildCibDatasets(downloads: Downloads, generatedAt: string) {
  const { annual, categories } = buildCisRecords(downloads);
  const cips = buildCipsRecords(downloads);
  const failed = [...annual, ...categories, ...cips].flatMap((r) => r.checks.filter((c) => !c.ok).map((c) => ({ key: `${r.year} ${c.name}`, detail: c.detail })));
  return {
    failed,
    cisAnnual: dataset("cis-annual", "Citizens Information Services: callers and queries by year",
      "Annual national callers and queries handled by the Citizens Information Services network.", CIS_HUB, [
        ...COMMON_NOTES,
        "2021–2024 callers are the annual figures printed on each year's CIS statistical summary page.",
        "CIB publishes no annual callers figure for 2025. The 2025 value is the sum of the four 2025 quarterly reports (callers_basis = derived_sum_of_quarterly_reports). The 2024 quarterly reports (106,122 + 99,181 + 101,610 + 88,104) sum to the published 2024 annual figure.",
        "The 2024 report profiles 767,168 non-casework queries. It reports 1,517 new long-term advocacy cases separately, and calls the ratio 'queries per interaction'."
      ], annual, generatedAt),
    cisCategories: dataset("cis-query-categories", "Citizens Information Services: queries by top-level category",
      "Table 1 of each year's CIS Query Categories report: queries per top-level category.", CIS_HUB, [
        ...COMMON_NOTES,
        "'Local' is a generic signposting and referral category with no published breakdown.",
        "Only top-level categories are included. Sub-category tables are not transcribed.",
        "The 2025 Table 1 column headed '% Sub-Category' is the share of all queries; it is stored as share_pct_published."
      ], categories, generatedAt),
    cips: dataset("cips-annual", "Citizens Information Phone Service: contacts and call categories by year",
      "Annual contacts by mode and categorised calls by top-level category for the Citizens Information Phone Service.", CIPS_HUB, [
        ...COMMON_NOTES,
        "Methodology change: the published 'calls answered' figure counts telephone, webchat and social-media contacts in 2021–2023, but telephone calls only in 2024–2025. Use contacts.total for a like-for-like series.",
        "Categorised calls are a subset of all contacts; not every call is categorised. Category sets also vary by year, for example Budget, Ukraine and Covid-19.",
        "The 2023 contact-mode table is headed 'Number of Callers (Q1 2023)', but its rows sum to the annual 135,477 contacts given in the text.",
        "In the 2025 report, three sub-category table totals differ slightly from the main category table: Housing 6,382 vs 6,381, Money and Tax 6,014 vs 6,012, Moving Country 4,108 vs 4,105. The main-table figures are stored; see each record's checks."
      ], cips, generatedAt)
  };
}
