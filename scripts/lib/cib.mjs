// Builds and verifies the Citizens Information Board (CIB) Data Hub snapshots in web/data/cib/.
// Pure functions: the refresh script downloads the files; tests can call these with local bytes.
import { docxBlocks, docxText, htmlText, parseCount, parsePercent, sha256, textContainsFigure } from "./docx.mjs";

export const CIB_HOST = "www.citizensinformationboard.ie";
const BASE = `https://${CIB_HOST}`;
export const CIS_HUB = `${BASE}/en/data-hub/cis-data-hub/`;
export const CIPS_HUB = `${BASE}/en/data-hub/cips-data-hub/`;
export const PSI_NOTICE = `${BASE}/en/notices/psi.html`;
export const SCHEMA_VERSION = 1;

export const LICENCE = {
  name: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
  url: "https://creativecommons.org/licenses/by/4.0/",
  notice_url: PSI_NOTICE,
  attribution: "Contains Irish Public Sector Data licensed under a Creative Commons Attribution 4.0 International (CC BY 4.0) licence",
  credit: "Citizens Information Board"
};

const summaryPage = (year) => `${CIS_HUB}${year}-statistical-summary/`;
const datahub = (file) => `${BASE}/downloads/datahub/${file}`;

/** Every file the snapshots cite. Fixed official URLs only; nothing is built from user input. */
export const CIB_SOURCES = [
  { id: "psi-notice", url: PSI_NOTICE, page_url: PSI_NOTICE, format: "html", description: "CIB re-use of public sector information notice (licence)" },
  { id: "cis-caller-profile-2021", url: datahub("caller-profile2021.docx"), page_url: summaryPage(2021), format: "docx", description: "CIS caller demand 2021" },
  { id: "cis-summary-2022", url: summaryPage(2022), page_url: summaryPage(2022), format: "html", description: "CIS 2022 statistical summary page" },
  { id: "cis-summary-2023", url: summaryPage(2023), page_url: summaryPage(2023), format: "html", description: "CIS 2023 statistical summary page" },
  { id: "cis-summary-2024", url: summaryPage(2024), page_url: summaryPage(2024), format: "html", description: "CIS 2024 statistical summary page" },
  { id: "cis-query-categories-2021", url: datahub("query-categories2021.docx"), page_url: summaryPage(2021), format: "docx", description: "CIS query profile 2021" },
  { id: "cis-query-categories-2022", url: datahub("query-categories-2022.docx"), page_url: summaryPage(2022), format: "docx", description: "CIS query profile 2022" },
  { id: "cis-query-categories-2023", url: datahub("query-categories-2023-v3.docx"), page_url: summaryPage(2023), format: "docx", description: "CIS query profile 2023" },
  { id: "cis-query-categories-2024", url: datahub("query-categories-2024.docx"), page_url: summaryPage(2024), format: "docx", description: "CIS query profile 2024" },
  { id: "cis-query-categories-2025", url: datahub("query-categories-2025.docx"), page_url: summaryPage(2025), format: "docx", description: "CIS query and caller data 2025" },
  ...[
    [2023, ["q1-2023.docx", "q2-2023-cis.docx", "q3-2023-1.docx", "q4-2023-cis.docx"]],
    [2024, ["q1-2024-v3.docx", "q2-2024.docx", "q3-2024.docx", "q4-2024.docx"]],
    [2025, ["q1-2025.docx", "Q2-2025-CIS-statistical-report.docx", "Q3-2025-CIS-statistical-report.docx", "Q4-2025-CIS-statistical-report.docx"]]
  ].flatMap(([year, files]) => files.map((file, i) => ({
    id: `cis-q${i + 1}-${year}`, url: datahub(file), page_url: CIS_HUB, format: "docx", description: `CIS statistical report Q${i + 1} ${year}`
  }))),
  ...[["2021", "CIPS-statistical-summary-2021-1.docx"], ["2022", "CIPS-statistical-summary-2022-1.docx"], ["2023", "CIPS-statistical-summary-2023.docx"], ["2024", "CIPS-statistical-summary-2024.docx"], ["2025", "CIPS-statistical-summary-2025.docx"]]
    .map(([year, file]) => ({ id: `cips-summary-${year}`, url: datahub(file), page_url: CIPS_HUB, format: "docx", description: `CIPS statistical summary ${year}` }))
];

/** Figures stated in the task brief and re-verified against the files. The builder must reproduce them exactly. */
export const PINNED = {
  annual: { 2022: [394400, 788902], 2023: [397605, 795278], 2024: [395017, 767168], 2025: [384091, 708862] },
  categories2025: { "Social Welfare": 315200, Housing: 82209, Health: 51513, "Money and Tax": 47635, Employment: 39265, "Moving Country": 38364 },
  cips2025: { telephone: 111472, webchat: 1792, social_media: 240, total: 113504, categorised: 63609, "Social Welfare": 26291, Housing: 6382, "Money and Tax": 6014 }
};

/** Reviewed label map. Any label not listed here stops the refresh rather than being guessed. */
const CATEGORY_LABELS = new Map([
  ...["Social Welfare", "Housing", "Employment", "Health", "Money and Tax", "Local", "Moving Country", "Justice", "Travel and Recreation",
    "Education and Training", "Consumer Affairs", "Death and Bereavement", "Government in Ireland", "Environment", "Ukraine",
    "Birth, Family and Relationships", "Covid-19", "Budget 2023", "Budget 2024", "Budget 2025"].map((c) => [c, c]),
  ["Birth, Family & Relationships", "Birth, Family and Relationships"],
  ["Birth Family and Relationship", "Birth, Family and Relationships"],
  ["Covid 19", "Covid-19"],
  ["Covid19", "Covid-19"],
  ["Money & Tax", "Money and Tax"]
]);

const CANONICAL = [...new Set(CATEGORY_LABELS.values())];
/** The first canonical category named in free text such as a table caption or total-row label. */
const categoryNamedIn = (text) => CANONICAL.find((c) => new RegExp(c.replace(/ and /g, " (?:and|&) "), "i").test(text));

export function canonicalCategory(label) {
  const clean = label.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  const canonical = CATEGORY_LABELS.get(clean);
  if (!canonical) throw new Error(`Unreviewed CIB category label ${JSON.stringify(label)}. Add it to CATEGORY_LABELS after checking the source.`);
  return canonical;
}

const clean = (s) => s.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
const figure = (printed, source) => ({ value: parseCount(printed), printed: clean(printed), source });

function textOf(file) {
  return file.format === "html" ? htmlText(file.bytes.toString("utf8")) : docxText(file.bytes);
}

function match(text, pattern, label) {
  const m = text.match(pattern);
  if (!m) throw new Error(`${label}: expected text ${pattern} was not found.`);
  return m;
}

function table(blocks, captionPattern, label) {
  const found = blocks.find((b) => b.type === "table" && captionPattern.test(b.caption));
  if (!found) throw new Error(`${label}: no table captioned ${captionPattern}.`);
  return found;
}

const isTotalRow = (row) => row[0] === "" || /^total/i.test(clean(row[0]));

function categoryRows(rows, valueColumn, source, label) {
  const body = rows.slice(1);
  const shareColumn = rows[0].findIndex((h, i) => i > valueColumn && /^%/.test(clean(h)) && !/change/i.test(h));
  if (shareColumn < 0) throw new Error(`${label}: category table has no share column.`);
  const totalIndex = body.findIndex(isTotalRow);
  if (totalIndex < 0) throw new Error(`${label}: category table has no total row.`);
  const categories = body.slice(0, totalIndex).map((row) => {
    const printed = clean(row[valueColumn] ?? "");
    return { category: canonicalCategory(row[0]), source_label: clean(row[0]), count: figure(printed, source), share_percent: parsePercent(row[shareColumn] ?? "") };
  });
  const totalRow = body[totalIndex];
  return { categories, total: figure(totalRow[valueColumn], source) };
}

function sumCheck(categories, total) {
  const sum = categories.reduce((acc, c) => acc + c.count.value, 0);
  return { sum_of_categories: sum, matches_total: sum === total.value };
}

/** Builds the three snapshot documents from downloaded files keyed by source id ({ bytes: Buffer }). */
export function buildCibSnapshots(files, asOf) {
  const loaded = new Map();
  for (const source of CIB_SOURCES) {
    const file = files.get(source.id);
    if (!file) throw new Error(`Missing downloaded file for ${source.id} (${source.url}).`);
    const bytes = Buffer.from(file.bytes);
    loaded.set(source.id, { ...source, bytes, sha256: sha256(bytes), size: bytes.length, text: textOf({ ...source, bytes }), blocks: source.format === "docx" ? docxBlocks(bytes) : [] });
  }
  const get = (id) => loaded.get(id);
  const sourceList = (ids) => ids.map((id) => {
    const f = get(id);
    return { id, url: f.url, page_url: f.page_url, format: f.format, description: f.description, sha256: f.sha256, bytes: f.size };
  });
  const licenceText = get("psi-notice").text;
  if (!licenceText.includes(LICENCE.attribution)) throw new Error("The CIB PSI notice no longer contains the expected CC BY 4.0 attribution statement.");

  // Query categories (Table 1 of each query-categories file).
  const categoryYears = [2021, 2022, 2023, 2024, 2025].map((year) => {
    const id = `cis-query-categories-${year}`;
    const t = get(id).blocks.find((b) => b.type === "table");
    if (!t) throw new Error(`${id}: no tables.`);
    const { categories, total } = categoryRows(t.rows, 1, id, id);
    const check = sumCheck(categories, total);
    if (!check.matches_total) throw new Error(`${id}: categories sum to ${check.sum_of_categories}, table total is ${total.value}.`);
    return {
      year, source: id, table: clean(t.caption), total_queries: total,
      categories: categories.map((c) => ({ category: c.category, source_label: c.source_label, queries: c.count, share_percent: c.share_percent })),
      ...check
    };
  });

  // Annual callers and queries.
  const quarterIds = (year) => [1, 2, 3, 4].map((q) => `cis-q${q}-${year}`);
  const quarterly = (year) => quarterIds(year).map((id, i) => {
    const m = match(get(id).text, new RegExp(`There were ([\\d,]+) callers to CISs? nationally during Q${i + 1},? ${year}`), id);
    return { quarter: i + 1, callers: figure(m[1], id) };
  });
  const callerFigures = {
    2021: () => figure(match(get("cis-caller-profile-2021").text, /There were ([\d,]+) callers to Citizens Information Services \(CISs\) in 2021/, "2021 callers")[1], "cis-caller-profile-2021"),
    2022: () => figure(match(get("cis-summary-2022").text, /Overview ([\d,]+) callers were assisted/, "2022 callers")[1], "cis-summary-2022"),
    2023: () => figure(match(get("cis-summary-2023").text, /Overview ([\d,]+) callers were assisted/, "2023 callers")[1], "cis-summary-2023"),
    2024: () => figure(match(get("cis-summary-2024").text, /nationwide assisted ([\d,]+) callers/, "2024 callers")[1], "cis-summary-2024")
  };
  const annualYears = categoryYears.map((cy) => {
    const year = cy.year;
    const queryText = match(get(cy.source).text, /([\d,]+) queries from the public/, `${year} queries`)[1];
    if (parseCount(queryText) !== cy.total_queries.value) throw new Error(`${year}: query text ${queryText} differs from Table 1 total ${cy.total_queries.printed}.`);
    const entry = { year, queries: cy.total_queries };
    const quarters = year >= 2023 ? quarterly(year) : null;
    const quarterSum = quarters?.reduce((acc, q) => acc + q.callers.value, 0);
    if (callerFigures[year]) {
      entry.callers = { ...callerFigures[year](), derived: false };
      if (quarters && quarterSum !== entry.callers.value) throw new Error(`${year}: quarterly callers sum to ${quarterSum}, annual figure is ${entry.callers.value}.`);
    } else {
      entry.callers = {
        value: quarterSum, printed: null, source: null, derived: true,
        method: `Sum of the callers stated in the four ${year} CIS quarterly statistical reports. The annual summary for ${year} does not print a caller total. For 2023 and 2024 the same sum equals the published annual figure.`
      };
    }
    if (quarters) entry.quarterly_callers = quarters;
    return entry;
  });

  // CIPS.
  const cipsYears = [2021, 2022, 2023, 2024, 2025].map((year) => {
    const id = `cips-summary-${year}`;
    const { blocks, text } = get(id);
    const contactTable = table(blocks, /type of contact|mode of contact/i, id);
    const modes = {};
    let tableTotal = null;
    for (const row of contactTable.rows.slice(1)) {
      const label = clean(row[0]).toLowerCase();
      if (label === "telephone") modes.telephone = figure(row[1], id);
      else if (/^web ?chats?$/.test(label)) modes.webchat = figure(row[1], id);
      else if (label === "social media enquiries") modes.social_media = figure(row[1], id);
      else if (label === "total") tableTotal = figure(row[1], id);
      else throw new Error(`${id}: unexpected contact mode ${JSON.stringify(row[0])}.`);
    }
    if (!modes.telephone || !modes.webchat || !modes.social_media) throw new Error(`${id}: incomplete contact mode table.`);
    const modeSum = modes.telephone.value + modes.webchat.value + modes.social_media.value;
    const notes = [];
    let total;
    if (tableTotal) {
      total = { ...tableTotal, basis: "table" };
    } else {
      const m = match(text, new RegExp(`There were ([\\d,]+) calls answered by CIPS during ${year}`), `${id} total`);
      total = { ...figure(m[1], id), basis: "text" };
      notes.push(`The contact-mode table has no total row; the total is the report text "There were ${clean(m[1])} calls answered by CIPS during ${year}", which equals telephone + webchat + social media.`);
    }
    if (total.value !== modeSum) throw new Error(`${id}: contact modes sum to ${modeSum}, total is ${total.value}.`);
    const header = contactTable.rows[0]?.[1] ?? "";
    if (/Q1/.test(header)) notes.push(`The contact-mode table header reads "${clean(header)}", but the figures are the full-year ${year} totals stated in the report text.`);

    const main = table(blocks, /main category of calls/i, id);
    const { categories, total: categorised } = categoryRows(main.rows, 1, id, id);
    const check = sumCheck(categories, categorised);
    if (!check.matches_total) notes.push(`Main categories sum to ${check.sum_of_categories.toLocaleString("en-IE")}, but the table states ${categorised.printed} categorised calls.`);
    const out = categories.map((c) => ({ category: c.category, source_label: c.source_label, calls: c.count, share_percent: c.share_percent }));

    // Sub-category tables repeat each top category's total; record any disagreement with the main table.
    for (const sub of blocks.filter((b) => b.type === "table" && /sub-?categor/i.test(b.caption) && !/most queried/i.test(b.caption))) {
      const last = sub.rows.at(-1).map(clean);
      const totalCell = last.findIndex((c) => /^[\d,]+$/.test(c));
      const labelText = last.slice(0, totalCell).join(" ").trim();
      // The total-row label wins over the caption: CIPS 2021 Table 7 is captioned Moving Country but totals Money and Tax.
      const captionName = categoryNamedIn(sub.caption);
      const name = categoryNamedIn(labelText) ?? captionName;
      if (!name) throw new Error(`${id}: cannot identify the category of sub-category table "${sub.caption}".`);
      if (captionName && captionName !== name) notes.push(`"${clean(sub.caption)}" ends with a total row labelled "${labelText}" (${last[totalCell]}); it is treated as the ${name} breakdown.`);
      const row = out.find((c) => c.category === name);
      if (!row) throw new Error(`${id}: sub-category table for ${name} has no main-table row.`);
      const subTotal = figure(last[totalCell], id);
      if (subTotal.value !== row.calls.value) {
        row.subcategory_table_total = { ...subTotal, table: clean(sub.caption) };
        row.note = `The main category table states ${row.calls.printed}; the ${name} sub-category table totals ${subTotal.printed}. The main table value is used.`;
        notes.push(`${name}: ${row.note}`);
      }
    }
    return {
      year, source: id, contacts: { ...modes, total }, categorised_calls: categorised,
      categories: out, ...check, notes
    };
  });

  verifyPinned(annualYears, categoryYears, cipsYears);

  const common = (dataset, title, ids, notes) => ({
    schema_version: SCHEMA_VERSION, dataset, title, publisher: "Citizens Information Board", as_of: asOf,
    licence: LICENCE, data_hub_url: dataset === "cib-cips" ? CIPS_HUB : CIS_HUB, sources: sourceList(["psi-notice", ...ids]), notes
  });
  const annual = {
    ...common("cib-cis-annual", "Citizens Information Services (CIS): annual callers and queries", [
      "cis-caller-profile-2021", "cis-summary-2022", "cis-summary-2023", "cis-summary-2024",
      ...categoryYears.map((c) => c.source), ...[2023, 2024, 2025].flatMap(quarterIds)
    ], [
      "Callers are CIS client contacts recorded by the eight regional Citizens Information Service companies; one caller can raise several queries.",
      "Queries are the Table 1 total of each year's query-category file and match the overview text of the same file.",
      "2025 callers are derived: the four 2025 quarterly reports are summed because no annual caller total is printed. The same method reproduces the published 2023 and 2024 annual totals exactly.",
      "The 2022 summary page rounds queries to \"over 788,900\"; the exact 788,902 comes from the 2022 query-category file."
    ]),
    years: annualYears
  };
  const categoriesDoc = {
    ...common("cib-cis-query-categories", "Citizens Information Services (CIS): queries by top-level category", categoryYears.map((c) => c.source), [
      "Values are Table 1 of each year's CIS query-category file. Category sums equal the stated total in every year.",
      "category is a normalised name for comparing years; source_label is the label printed in the file.",
      "share_percent is the percentage printed in the file, not recomputed."
    ]),
    years: categoryYears
  };
  const cips = {
    ...common("cib-cips", "Citizens Information Phone Service (CIPS): contacts and call categories", cipsYears.map((c) => c.source), [
      "contacts counts every answered telephone call, webchat and social media enquiry. categorised_calls counts the calls assigned a main category, a subset of contacts.",
      "Where a sub-category table total disagrees with the main category table, the main table value is kept and the difference is recorded on the category and in the year's notes."
    ]),
    years: cipsYears
  };
  const documents = { "cis-annual.json": annual, "cis-query-categories.json": categoriesDoc, "cips.json": cips };
  verifyFigures(documents, loaded);
  return documents;
}

function verifyPinned(annual, categories, cips) {
  const fail = (msg) => { throw new Error(`Pinned figure check failed: ${msg}`); };
  for (const [year, [callers, queries]] of Object.entries(PINNED.annual)) {
    const row = annual.find((a) => a.year === Number(year));
    if (row?.callers.value !== callers || row?.queries.value !== queries) fail(`CIS ${year} expected ${callers}/${queries}, parsed ${row?.callers.value}/${row?.queries.value}.`);
  }
  const c2025 = categories.find((c) => c.year === 2025);
  for (const [name, value] of Object.entries(PINNED.categories2025)) {
    const got = c2025?.categories.find((c) => c.category === name)?.queries.value;
    if (got !== value) fail(`CIS 2025 ${name} expected ${value}, parsed ${got}.`);
  }
  const p = cips.find((c) => c.year === 2025);
  const got = {
    telephone: p?.contacts.telephone.value, webchat: p?.contacts.webchat.value, social_media: p?.contacts.social_media.value,
    total: p?.contacts.total.value, categorised: p?.categorised_calls.value,
    ...Object.fromEntries((p?.categories ?? []).map((c) => [c.category, c.calls.value]))
  };
  for (const [key, value] of Object.entries(PINNED.cips2025)) if (got[key] !== value) fail(`CIPS 2025 ${key} expected ${value}, parsed ${got[key]}.`);
}

/** Every printed figure in the documents, with its JSON path: { path, printed, value, source }. */
export function listFigures(documents) {
  const figures = [];
  const walk = (node, path) => {
    if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}[${i}]`));
    if (!node || typeof node !== "object") return;
    if (typeof node.printed === "string") figures.push({ path, printed: node.printed, value: node.value, source: node.source });
    for (const [k, v] of Object.entries(node)) if (k !== "sources") walk(v, `${path}.${k}`);
  };
  for (const [name, doc] of Object.entries(documents)) walk(doc.years, `${name.replace(/\.json$/, "")}.years`);
  return figures;
}

/** Every figure with a printed form must occur verbatim in the text of the file it cites. Returns the count checked. */
export function verifyFigures(documents, loaded) {
  const figures = listFigures(documents);
  const failures = [];
  for (const { path, printed, value, source } of figures) {
    const file = loaded.get(source);
    if (!file) failures.push(`${path}: unknown source ${source}`);
    else if (!textContainsFigure(file.text, printed)) failures.push(`${path}: "${printed}" not found in ${file.url}`);
    else if (parseCount(printed) !== value) failures.push(`${path}: value ${value} does not match printed ${printed}`);
  }
  if (failures.length) throw new Error(`Figure verification failed:\n${failures.join("\n")}`);
  return figures.length;
}

/** Strips fields that legitimately change between runs, so --check compares content only. */
export function comparable(doc) {
  return JSON.stringify({ ...doc, as_of: null });
}
