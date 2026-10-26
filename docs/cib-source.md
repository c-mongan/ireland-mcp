# Citizens Information Board Data Hub source (`cib`)

The `cib` source answers questions about Citizens Information Board (CIB) service
statistics: Citizens Information Services (CIS) callers and queries, and the
Citizens Information Phone Service (CIPS). It is separate from the optional
`citizens-info` pilot, which indexes explanatory guidance pages.

| Operation | Arguments | Returns |
| --- | --- | --- |
| `cib_cis_annual_summary` | `year?` | CIS callers and queries per year; 2023–2025 quarterly callers |
| `cib_cis_query_categories` | `year?`, `category?` | CIS queries by top-level category, or one category as a time series |
| `cib_cips_summary` | `year?` | CIPS contacts by mode, categorised calls by main category, recorded table mismatches |

```json
{"source":"cib","operation":"cib_cis_query_categories","args":{"category":"Housing"}}
```

Every response includes `as_of`, `attribution`, `credit`, `licence_url`,
`licence_notice_url`, `data_hub_url`, `source_urls`, `snapshot_file`,
`live: false` and the snapshot `notes`. The envelope `retrieved_at` is the
snapshot date, not the request time.

## Single source of truth

The tools read the JSON files in [`web/data/cib/`](../web/data/cib/). There is
no runtime scraping or upstream request.

- The public site serves the same files at `https://irishopendata.ie/data/cib/`.
  They are linked from `web/llms.txt`.
- `npm run build` copies `web/data/` to `dist/web/data/`
  (`scripts/copy-assets.mjs`). `package.json` `files` includes `dist/web/data`,
  and `scripts/deploy-zip.sh` ships all of `dist/`. The npm package, the Azure
  Functions app and a local checkout therefore read identical files.
- The static site deploys automatically when `web/**` changes on `main`. The
  Functions app deploys manually. After a refresh, the site can show newer JSON
  than the hosted MCP server until the next Functions deploy. Compare `as_of`.

## Licence and attribution

CIB's [re-use of public sector information notice](https://www.citizensinformationboard.ie/en/notices/psi.html)
licenses its public sector information under CC BY 4.0. Use this attribution,
which every snapshot and response carries:

> Contains Irish Public Sector Data licensed under a Creative Commons Attribution
> 4.0 International (CC BY 4.0) licence.

Credit: Citizens Information Board. The refresh script fails if the notice no
longer contains this statement.

## Snapshot schema (version 1)

All three files share these top-level fields:

| Field | Meaning |
| --- | --- |
| `schema_version` | `1` |
| `dataset` | `cib-cis-annual`, `cib-cis-query-categories` or `cib-cips` |
| `title`, `publisher` | Human-readable title; always `Citizens Information Board` |
| `as_of` | Date (YYYY-MM-DD) the source files were downloaded and verified |
| `licence` | `name`, `url`, `notice_url`, `attribution`, `credit` |
| `data_hub_url` | CIS or CIPS Data Hub page |
| `sources[]` | `id`, `url`, `page_url`, `format` (`docx` or `html`), `description`, `sha256`, `bytes` of every cited file |
| `notes[]` | Dataset-wide caveats |
| `years[]` | Dataset-specific rows, below |

A **figure** is `{ "value": 394400, "printed": "394,400", "source": "cis-summary-2022" }`.
`printed` is the exact text in the cited file and `source` is a `sources[].id`.
The loader (`src/sources/cib/snapshot.ts`) validates the schema with zod and
rejects any figure that cites an unlisted source.

- `cis-annual.json` `years[]`: `year`, `queries` (figure), `callers` (figure
  with `derived: false`, or `{ value, printed: null, source: null, derived: true, method }`),
  and `quarterly_callers[]` (`quarter`, `callers` figure) for 2023–2025.
- `cis-query-categories.json` `years[]`: `year`, `source`, `table` (caption),
  `total_queries` (figure), `categories[]` (`category`, `source_label`,
  `queries` figure, `share_percent`), `sum_of_categories`, `matches_total`.
- `cips.json` `years[]`: `year`, `source`, `contacts` (`telephone`, `webchat`,
  `social_media` figures; `total` figure with `basis` `table` or `text`),
  `categorised_calls` (figure), `categories[]` (`category`, `source_label`,
  `calls` figure, `share_percent`, optional `subcategory_table_total` and
  `note`), `sum_of_categories`, `matches_total`, `notes[]`.

`category` is a normalised name for comparing years, mapped from a reviewed
list in `scripts/lib/cib.mjs`. `source_label` is the printed label. An
unreviewed label stops the refresh.

## Provenance and known source issues

Verified against the official files on 26 October 2026.

| Year | CIS callers | Source | CIS queries | Source |
| --- | ---: | --- | ---: | --- |
| 2021 | 338,167 | `caller-profile2021.docx` text | 693,918 | `query-categories2021.docx` Table 1 |
| 2022 | 394,400 | 2022 summary page | 788,902 | `query-categories-2022.docx` Table 1 |
| 2023 | 397,605 | 2023 summary page | 795,278 | `query-categories-2023-v3.docx` Table 1 |
| 2024 | 395,017 | 2024 summary page | 767,168 | `query-categories-2024.docx` Table 1 |
| 2025 | 384,091 (derived) | sum of Q1–Q4 2025 reports | 708,862 | `query-categories-2025.docx` Table 1 |

- **2025 callers are derived.** No 2025 file prints an annual caller total. The
  value is 101,462 + 94,372 + 102,062 + 86,195 from the four quarterly reports.
  The same sum reproduces the published 2023 (397,605) and 2024 (395,017)
  totals exactly, and the refresh script checks that.
- **2022 queries:** the summary page says "over 788,900"; the exact figure comes
  from the 2022 query-category file.
- **CIPS 2025 table disagreements.** The main category table and the sub-category
  table totals differ. The snapshot keeps the main table value and records the
  other on the category:

  | Category | Main table | Sub-category table total |
  | --- | ---: | ---: |
  | Housing | 6,382 | 6,381 |
  | Money and Tax | 6,014 | 6,012 |
  | Moving Country | 4,108 | 4,105 |

- **CIPS 2021–2023 totals:** the contact-mode tables have no total row. The
  total comes from the report text ("There were N calls answered by CIPS") and
  equals telephone + webchat + social media (`basis: "text"`).
- **CIPS 2023:** the contact-mode table header reads "(Q1 2023)", but the figures
  are the full-year totals stated in the text.
- **CIPS 2021:** Table 7 is captioned "Moving Country" but totals "Money and Tax
  Calls" (5,658, the Money and Tax main-table value). It is treated as the Money
  and Tax breakdown.
- CIS category sums equal the stated totals in every year. CIPS main categories
  sum to the stated categorised-call totals in every year.
- Categorised CIPS calls are a subset of all CIPS contacts.

## Refreshing

```bash
node scripts/refresh-cib-snapshot.mjs              # check only; exits 1 on any drift
node scripts/refresh-cib-snapshot.mjs --evidence   # also prints every figure and its file URL
node scripts/refresh-cib-snapshot.mjs --write      # rewrite web/data/cib/*.json after review
```

The script downloads every cited file from fixed `https://www.citizensinformationboard.ie`
URLs (10 MiB limit, no redirects), recomputes SHA-256 and re-parses the Word
tables with a dependency-free reader (`scripts/lib/docx.mjs`). It then:

1. checks that each pinned figure in `PINNED` is reproduced exactly;
2. checks that every figure's `printed` text occurs as a whole number in its cited file;
3. checks that category sums, contact-mode sums and 2023–2024 quarterly sums match;
4. in check mode, fails if the regenerated snapshots differ from the committed files, and names any file whose checksum changed.

For a new year, add its files to `CIB_SOURCES` and its year to the builder,
run `--write`, review the diff, update `PINNED`, then run the tests.

## Draft request for machine-readable data (not sent)

This draft has not been sent. It asks CIB to publish the statistics in an
open, machine-readable format.

> **To:** psi@ciboard.ie
> **Subject:** Request under the PSI Regulations: CIS and CIPS statistics in CSV or XLSX
>
> Dear Re-use Officer,
>
> I am writing under the European Union (Open Data and Re-use of Public Sector
> Information) Regulations 2021 (S.I. No. 376 of 2021).
>
> The Citizens Information Board Data Hub publishes Citizens Information Services
> (CIS) and Citizens Information Phone Service (CIPS) statistics as Word and PDF
> reports under CC BY 4.0. I reuse them in an open-source, read-only data service
> with full attribution.
>
> Please could you make the following available in an open, machine-readable
> format such as CSV or XLSX:
>
> 1. CIS callers and queries by year and by quarter, from 2021 to date.
> 2. CIS queries by top-level category and sub-category, by year.
> 3. CIPS contacts by mode (telephone, webchat, social media) and categorised calls
>    by main category and sub-category, by year and quarter.
> 4. Any existing data dictionary or definitions, such as how callers, queries and
>    categorised calls are counted.
>
> The Regulations ask public sector bodies to make documents available, where
> possible and appropriate, in open and machine-readable formats together with
> their metadata. If the data already
> exists in a spreadsheet, the existing file would be ideal. I would also welcome
> confirmation of which figure is authoritative where the 2025 CIPS report's main
> category table and sub-category tables differ (Housing 6,382 or 6,381; Money and
> Tax 6,014 or 6,012; Moving Country 4,108 or 4,105), and whether an annual 2025
> CIS caller total will be published.
>
> Thank you for your help.
>
> Kind regards,
> [Name]
