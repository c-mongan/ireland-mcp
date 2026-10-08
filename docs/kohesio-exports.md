# Kohesio Ireland export snapshots

Verified on 2026-10-08 against current main and the European Commission's official download listings. The Kohesio team confirmed on 2026-10-07 that the public API primarily serves the frontend, is rate-limited and is unsuitable for hosted retrieval. They recommended periodically retrieving the Irish exports and explicitly permitted reuse. Underlying records may update only once or twice a year; a new export directory does not imply all Irish records changed.

## Official exports verified

| Programming period | Snapshot directory date | Official CSV | Rows | Columns | SHA-256 |
| --- | --- | --- | ---: | ---: | --- |
| 2014–2020 | 2026-09-24 | [IE-pp14-20-20260924.csv](https://kohesio.ec.europa.eu/api/data/object?id=data/projects-2014-2020/2026-09-24/IE-pp14-20-20260924.csv) | 793 | 40 | `39e5c3f539eb4cc2d36f79c4a60de6b288538bf61208ec3e8158868ef904a3dd` |
| 2021–2027 | 2026-09-24 | [IE-pp21-27-20260924.csv](https://kohesio.ec.europa.eu/api/data/object?id=data/projects-2021-2027/2026-09-24/IE-pp21-27-20260924.csv) | 186 | 44 | `d23795967067d841bbb5fb36b722eba14171c03068c406ecab514ca19aed723e` |

The URLs are the exact downloads exposed by the official data page, not the `/api/projects` frontend query endpoints. Each appeared in its dated official listing:

- [2014–2020 listing](https://kohesio.ec.europa.eu/api/data/projects-2014-2020/2026-09-24)
- [2021–2027 listing](https://kohesio.ec.europa.eu/api/data/projects-2021-2027/2026-09-24)
- [Official data page](https://kohesio.ec.europa.eu/en/data)

The header names, checksums, row counts, source URLs, snapshot dates and actual download time are also stored in `src/sources/kohesio/snapshot.json`. `publication_date` is null: the dated directory identifies the export snapshot, and neither listing provides a separate publication date. Download time is not a data freshness claim.

## Verified schema and contracts

CSV files are UTF-8, comma-delimited with a header. Quoted fields contain commas, escaped quotes and line breaks. Both periods have `Operation_Unique_Identifier` containing `https://linkedopendata.eu/entity/Q…`, `Country` containing `Ireland`, and `Programming_Period`. The 2014 export includes `Coordinates`; the 2021 export adds specific-objective, image, InfoRegio URL and country-code fields. The complete observed headers are retained in the snapshot metadata.

The adapter maps English operation name/summary (programme-language fallback), `DD/MM/YYYY` dates to ISO dates, decimal EU/total expenditure budgets, currency, beneficiary, fund, category, latitude/longitude, locality and NUTS labels/codes. Missing numbers remain null; they are never converted to zero. Existing Q-id/URL inputs, operation names, result project fields and `data.total`/`data.projects` are retained. The `region` filter now searches exported NUTS names/codes; keyword search covers title, summary, locality, regions, beneficiary and fund. Results sort by Q id, use bounded limit/offset and include snapshot evidence. Search totals describe this snapshot only.

The packaged snapshot covers **979 projects in the two Irish country files**. It excludes the separate Interreg export and projects added after the snapshot. Missing IDs return `NOT_FOUND` with that limitation. Cross-source search and fetch use the same data and disclose the snapshot. No MCP request downloads an export or calls the frontend API. `cached: true` means packaged data, `retrieved_at` is the download time; results explicitly return `kind: static_export` and `live: false`.

## Refresh and deployment

A maintainer should check the official data page monthly and refresh when a newer Irish export is published. There is no automatic refresh on user queries. Use an actual dated directory containing both Irish CSVs; do not pass `latest` or infer a publication date.

```sh
npm ci
npm run build
node scripts/refresh-kohesio.mjs 2026-09-24
npm run build
npm test -- src/sources/kohesio
npm run typecheck
```

Replace the example date only after checking the official listing. Refresh downloads each published file with bounded 30-second attempts, one transient retry, a 5 MiB file limit and 10,000 row limit. It checks schema, row widths, quoting, project IDs, country, period, budgets, dates and duplicates. Both files must validate before one atomic snapshot replacement. A failed refresh leaves the prior packaged snapshot intact. Review the generated metadata/data diff, commit it, and deploy the rebuilt artifact. Until deployment, hosted requests keep serving the explicitly dated old snapshot. This avoids hosted-IP availability and per-request rate-limit dependencies.

The build copies the snapshot into `dist/src/sources/kohesio/snapshot.json`, included by the existing npm/deployment packaging. Refresh requires a network able to access the official download endpoints; there is no claim that the Azure-hosted service can download them itself.

## Validation scope

The historical `docs/live-all-ops.md` 2026-10-07 rows record the previous frontend API's hosted 403s. They are preserved as historical evidence. This change is validated locally against real official exports and offline tests; hosted success requires deployment and a new hosted probe. Do not label the CSV snapshot as live data or change those historical rows to PASS without that probe.
