# Civic sources and GeoHive layers

These additions are part of this source revision. Use `ireland_catalogue` and `ireland_describe` on the server you connect to before assuming that it has these operations.

## GeoHive

`geohive_list_layers` still lists feature services. Pass `service` to inspect the actual layer IDs within one service. `geohive_query_layer` accepts `layer_id`. If omitted, it selects the service's sole feature layer, or layer 0 when several layers include it. A multi-layer service without layer 0 requires an explicit choice. Queries return attributes, not geometry.

For example, `Cadastral_Parcels_Freehold` has layer 12. Its queries now use that layer without requiring the caller to guess its ID. Service metadata and feature rows are validated before caching. A malformed upstream response is not a successful empty result.

## Register of Lobbying

Use source `lobbying`, operation `lobbying_search_returns`. The source queries the official SIPO JSON search endpoint, with return-date windows, words, lobbyist and designated-public-official filters. Effective dates and the upstream result total are returned. Requests are bounded to a year; split longer research periods into separate requests. See [source notes](lobbying-source.md) for defaults and pagination.

Results are published returns, not meeting counts. The adapter omits private contact fields and does not infer influence or wrongdoing. SIPO's PSI reuse terms and attribution travel with each response.

## Employer pay-gap reports

Use source `paygap`, operation `paygap_search_reports`. Filters accept a company-name fragment, report year and NACE industry. `offset` and `limit` page the filtered results.

The adapter reads the [annotated combined CSV](https://paygap.ie/downloads/annotated), including source report links and flags for incomplete data, removed reports, late filing and reported errors. It keeps duplicate employer/year reports separate. Blank metrics remain null; zero and negative percentages remain numeric. Unexpected non-decimal values remain source text. Metrics have unit `percent` and measurement kind `employer_reported`.

This is a collection of employer reports, not a representative census or proof of unequal pay for equivalent work. The [dataset repository](https://github.com/zenbuffy/irishGenderPayGap) states CC0 1.0; the original employer reports retain their own terms. Credit PayGap.ie and link the original report when using a figure.

If Azure receives HTTP 403 from the primary export, the tool uses the latest validated publisher GitHub snapshot and identifies that source and date in the response. The first request after the one-hour cache expires checks for a newer CSV commit; responses distinguish the snapshot date from the last successful check. Annotation flags are unavailable in that snapshot and are returned as null. See [fallback provenance and refresh notes](paygap-source-fallback.md).

## Council budgets

Use source `council-budgets`, then `council_budgets_list_years` and `council_budgets_get`. The source parses official Excel workbooks and preserves budget year, authority, service division, measure, units and source resource. These are budget estimates, not actual expenditure. Do not combine income and expenditure into a spend total. See [workbook coverage and verification](council-budgets-source.md).

## Verification

Run `npm run check` for deterministic project checks. After building, run `node scripts/check-mcp.mjs --extended` to check native MCP discovery and schemas. Run `node scripts/live-civic.mjs` for bounded read-only requests from the local stdio build to the live publishers. Add `--url https://mcp.irishopendata.ie/mcp` to verify the hosted deployment through the same checks. It checks GeoHive's nonzero layer, Lobbying defaults, PayGap records, supported budget years, and one hand-checked amount from each of the 2026 XLSX and 2016 XLS workbooks.

A current upstream failure or changed published workbook can fail the live check while fixture tests still pass. Investigate the source response; do not replace a failed live result with a fixture or claim deployment from local tests.
