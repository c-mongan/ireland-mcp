# Citizens Information Board statistics and the civic-tech directory

Two sources are served from pinned, checksummed JSON snapshots. The same files are
published on the website for any client, including AIs that do not use MCP. The MCP
tools read those files directly, so the website and the tools share one copy of the data.

| Source | Tools | Public file | Licence |
| --- | --- | --- | --- |
| `cib` | `cib_cis_annual_summary`, `cib_cis_query_categories`, `cib_cips_summary` | [`/data/cib/cis-annual.json`](https://irishopendata.ie/data/cib/cis-annual.json), [`/data/cib/cis-query-categories.json`](https://irishopendata.ie/data/cib/cis-query-categories.json), [`/data/cib/cips-annual.json`](https://irishopendata.ie/data/cib/cips-annual.json) | CC BY 4.0, Citizens Information Board |
| `civic-directory` | `civic_directory_search` | [`/data/civic-directory.json`](https://irishopendata.ie/data/civic-directory.json) | MIT (catalogue), William Kennedy |

The files are committed in `web/data/`. The build copies them to `dist/web/data/`, and
the static site serves them under `/data/` with `access-control-allow-origin: *`.
Every tool response includes `public_file` and `file_sha256`, so a caller can confirm
that a tool answer and a downloaded file came from the same bytes. A deployment of the
site and a deployment of the MCP server can still happen at different times.

## How these relate to the Citizens Information pilot

The optional `citizens-info` pilot (in `packages/irish-legal-mcp`) indexes explanatory
**guidance articles** from citizensinformation.ie. The `cib` source is different: it
holds **service statistics** published by the Citizens Information Board Data Hub,
such as how many people contacted Citizens Information Services and what they asked
about. Use `citizens-info` to explain an entitlement, and use `cib` for demand trends.
`cib` is part of the default profile; the pilot remains off by default.

## Citizens Information Board Data Hub (`cib`)

Publisher: [Citizens Information Board Data Hub](https://www.citizensinformationboard.ie/en/data-hub/).
Licence: CC BY 4.0 under the board's [PSI re-use notice](https://www.citizensinformationboard.ie/en/notices/psi.html).
Required attribution: "Contains Irish Public Sector Data licensed under a Creative
Commons Attribution 4.0 International (CC BY 4.0) licence", crediting the Citizens
Information Board. Every response and every file carries this text. `robots.txt`
allows all crawling.

The Data Hub publishes national aggregates only, as PDF, DOCX and HTML. There is no
CSV, API or county breakdown. These tools never read a report at request time.

### What is included

Each tool takes a `year` (2021–2025), so every answer carries its own source files and
checksums. For a multi-year series, fetch the public JSON file.

- **CIS annual** (`cis-annual.json`): callers, queries, the published queries-per-caller
  ratio and a recomputed ratio for 2021–2025.
- **CIS categories** (`cis-query-categories.json`): Table 1 of each year's Query
  Categories report, giving queries per top-level category. Sub-category tables are not
  included.
- **CIPS annual** (`cips-annual.json`): Citizens Information Phone Service contacts by
  mode, the published "calls answered" figure and sentence, and categorised calls by
  top-level category.

### Verified figures

| Year | CIS callers | CIS queries | Queries per caller | CIPS contacts | CIPS calls answered (as published) |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2021 | 338,167 | 693,918 | 2.05 | 165,047 | 165,047 (all modes) |
| 2022 | 394,400 | 788,902 | 2.00 | 137,829 | 137,829 (all modes) |
| 2023 | 397,605 | 795,278 | 2.00 | 135,477 | 135,477 (all modes) |
| 2024 | 395,017 | 767,168 | 1.94 | 144,709 | 142,583 (telephone only) |
| 2025 | 384,091 (derived) | 708,862 | 1.85 | 113,504 | 111,472 (telephone only) |

Verification on 26 October 2026:

1. The refresh parsed every figure from the official DOCX reports and HTML summary pages.
2. Every check passed except the three 2025 CIPS sub-table differences listed below.
3. All 166 category figures were also found in the matching PDF editions with `pdftotext`.
4. Category rows sum exactly to each published table total in every year.

### Methodology changes and known inconsistencies

- **2025 CIS callers are derived.** CIB has published no annual callers figure for 2025.
  The value is the sum of the four 2025 quarterly reports: 101,462 + 94,372 + 102,062 +
  86,195. The record sets `callers_basis` to `derived_sum_of_quarterly_reports` and
  includes `callers_derivation` with each operand and its URL. As a cross-check, the 2024
  quarterly reports sum to the published 2024 figure.
- **The CIPS "calls answered" definition changed.** It counts telephone, webchat and
  social-media contacts in 2021–2023, but telephone calls only in 2024–2025. Use
  `contacts.total` for a comparable series. Each record states its `calls_answered_basis`
  and the exact published sentence.
- **2025 CIPS sub-table totals differ from the main table:** Housing 6,382 vs 6,381;
  Money and Tax 6,014 vs 6,012; Moving Country 4,108 vs 4,105. The main-table figures are
  stored. The differences appear as failed checks in the record, and the refresh
  tolerates only these three.
- The 2023 CIPS contact table is headed "(Q1 2023)", but its rows sum to the annual total.
- In 2024 the CIS report covers 767,168 non-casework queries and reports 1,517
  long-term advocacy cases separately.
- Category labels vary between years (for example "Birth, Family & Relationships" and
  "Covid 19"). Compare years with `category_key`. "Local" is a generic signposting
  category with no breakdown.

### Refresh

```bash
npm run build
node scripts/refresh-cib.mjs
```

The refresh downloads only the pinned `citizensinformationboard.ie` URLs in
`src/sources/cib/build.ts`. It checksums every DOCX, PDF and HTML input and parses the
DOCX editions. It stops on any unexpected failed check, and it replaces the three files
only after all three have been built. The three files share one `generated_at`; the
health check reports a mixed set. Review the diff, update the pinned digests in
`src/sources/cib/cib.test.ts`, then run the tests. For a new
year, add its pinned URLs and caller pattern to `CIS_PINS` and `CIPS_PINS`.

## Éire Civic Tech Directory (`civic-directory`)

[CitizenData.ie](https://citizendata.ie/) lists Irish civic-tech projects. It has no
API or terms page. Its `robots.txt` sets `Content-Signal: search=yes,ai-train=no,use=reference`
and grants no `ai-input` permission (checked 26 October 2026). **Ireland MCP never fetches or scrapes citizendata.ie.** The
site's catalogue lives in the MIT-licensed
[williamkennedy/eire_civic_tech_directory](https://github.com/williamkennedy/eire_civic_tech_directory)
repository. The snapshot is built from `src/content/projects/*.md` at the pinned commit
`7f0aeaf1a8655b25e55f76dae94a497943970629` (119 projects).

`civic_directory_search` filters by text, category, owner and listed status, with
`limit` up to 50 and offset paging. Each result includes:

- the project's own link, labelled `as listed, unverified`;
- `citizendata_listing`: `https://citizendata.ie/project/{slug}`, labelled
  "see listing on CitizenData.ie". The URL is derived from the entry's file name, which
  the site uses as its page slug;
- the GitHub source URL at the pinned commit and the entry's SHA-256.

Status, owners and links are reproduced as listed. Eleven entries list the owner as
"Unknown". The parser accepts a deliberately strict YAML subset: one optional UTF-8 BOM
(69 files have one), known fields only, no duplicates, a JSON-style owner array, plain
scalars, and `http(s)` links. Any other entry stops the refresh.

```bash
npm run build
node scripts/refresh-civic-directory.mjs <40-character commit SHA>
```

After a refresh, review the diff and update the pinned digest in
`src/sources/civic-directory/civic-directory.test.ts`.

## File schemas

Every file is UTF-8 JSON with an exact `schema` identifier ending `#v1`; the tools refuse
any other value. Fields will not be removed or renamed within v1. Tests pin each file's
SHA-256, so a refresh or hand edit must update those digests deliberately after review.

### CIB files (`cis-annual`, `cis-query-categories`, `cips-annual`)

Top level: `schema`, `title`, `description`, `publisher`, `landing_page`, `licence`,
`licence_url`, `reuse_notice`, `attribution`, `as_of` (refresh date, `YYYY-MM-DD`),
`generated_at` (refresh timestamp, identical in all three files), `generated_by`,
`notes[]`, `records[]`.

Every record has `year`, `sources[]` and `checks[]`:

- `sources[]` entries contain `url`, `role`, `format` (`docx`, `pdf` or `html`),
  `sha256`, `bytes` and `retrieved_at`.
- `checks[]` entries contain `name`, `ok` and `detail`.

| File | Record fields |
| --- | --- |
| `cis-annual` | `callers`, `callers_basis`, optional `callers_derivation`, `queries`, `queries_per_caller_published`, `queries_per_caller_computed` |
| `cis-query-categories` | `total_queries`, and `categories[]` with `category`, `category_key`, `queries` and `share_pct_published` |
| `cips-annual` | `contacts` (`telephone`, `webchat`, `social_media`, `total`), `calls_answered_published`, `calls_answered_published_text`, `calls_answered_basis`, `comparability_note`, `categorised_calls_total`, and `categories[]` with `category`, `category_key`, `calls` and `share_pct_published` |

HTML page checksums describe the page as retrieved. Page markup can change without
the figures changing.

### `civic-directory.json`

Top level: `schema`, `title`, `description`, `publisher`, `maintainer`, `repository`,
`commit`, `commit_date`, `licence`, `licence_url`, `licence_text`, `licence_sha256`,
`attribution`, `listing_site`, `listing_note`, `verification`, `as_of`, `generated_at`,
`generated_by`, `projects[]`.

`projects[]` entries contain `slug`, `title`, `category`, `owners[]`, `description`,
`status_as_listed` (`active` or `inactive`), `founding_year` (or `null`), `link`,
`repo` (or `null`), `citizendata_listing_url`, `source_url` and `sha256` (of the raw
markdown file at the commit).

## Open data request

CIB publishes these statistics only as reports. A draft request for the underlying
tables as CSV or XLSX is in [cib-psi-request-draft.md](cib-psi-request-draft.md). It has
not been sent.
