# Live sanity results

`npm run build && npm run live:sanity` makes one real upstream call per source.
It does not run in unit tests or CI; the nightly `live-smoke` workflow runs it.
Each call is a real MCP client round trip. By default it goes through
`ireland_call` on the lean surface; `EVAL_TOOLSETS=all npm run live:sanity` calls
the typed tools directly instead.

## Acceptance policy

Each sample first uses the shared `assessResult` checks. A PASS requires valid
evidence fields, cache flags, a domain contract, and the source-specific sample
check. A stale response or an unavailable section in a combined response fails
the smoke run. Typed tools can omit the operation tag. A conflicting tag fails
on either surface.

NTA checks the real summary fields: `feed_timestamp`, `trips`, `cancelled`,
`added`, and `routes`. A valid feed with no updates can pass. A missing
`NTA_API_KEY` is SKIP. An invalid HTTP-200 feed is a typed `UPSTREAM_DOWN` error
and is not cached as an empty feed.

Only the exact marked tool error `UPSTREAM_DOWN: Kohesio returned HTTP 403.`
can become WARN for the known cloud-runner restriction. Wrong data, stale data,
other HTTP errors, and timeouts remain FAIL. One WARN is tolerated; any FAIL or
more than one WARN makes the process exit with code 1.

These checks prove response structure and selected consistency rules. They do
not prove publisher accuracy or completeness. Historical tables below record
their dated runs; they are not evidence of current provider availability.

## 2026-10-05, combined ArcGIS + TED + bikes (`feat/sources-ted-bikes`), local run

Default surface (7 tools listed, every case through `ireland_call`): 23 PASS,
1 SKIP (`nta_get_realtime_summary`, `NTA_API_KEY` not set), 0 FAIL.

| Source | Tool | Result | ms | Note |
|---|---|---|---|---|
| cso | cso_area_profile | PASS | 1062 | |
| oireachtas | oireachtas_search_bills | PASS | 224 | |
| geohive | geohive_boundaries_at_point | PASS | 147 | |
| data-gov-ie | datagov_search_datasets | PASS | 175 | |
| smart-dublin | smartdublin_search_datasets | PASS | 214 | |
| met-eireann | met_get_forecast | PASS | 247 | |
| met-eireann | met_get_warnings | PASS | 59 | |
| nta | nta_get_realtime_summary | SKIP | 0 | `NTA_API_KEY` not set locally |
| legislation | legislation_list_acts | PASS | 82 | |
| ppr | ppr_price_stats | PASS | 608 | |
| irish-rail | rail_get_departures | PASS | 175 | |
| luas | luas_get_forecast | PASS | 236 | |
| eirgrid | grid_get_status | PASS | 316 | |
| marine | marine_get_buoys | PASS | 302 | |
| opw-water | water_get_level | PASS | 522 | |
| planning | planning_search | PASS | 263 | NPAD ArcGIS keyless, CC BY 4.0 |
| planning | planning_get | PASS | 742 | NPAD ArcGIS keyless, CC BY 4.0 |
| census-areas | census_small_area_at | PASS | 289 | CSO/Tailte Éireann ArcGIS keyless, CC BY 4.0 |
| heritage | heritage_monuments_near | PASS | 459 | NMS SMR ArcGIS keyless, CC BY 4.0 |
| environment-sites | protected_sites_near | PASS | 387 | NPWS designated areas ArcGIS keyless, CC BY 4.0 |
| ted | ted_search_tenders | PASS | 166 | New source |
| bikes | bikes_stations_near | PASS | 235 | New source |
| cross | search | PASS | 360 | |
| cross | ireland_snapshot | PASS | 252 | |

## 2026-10-05, lean surface (`feat/lean-surface`), local run

Default surface (7 tools listed, every case through `ireland_call`): 16 PASS,
1 SKIP (`nta_get_realtime_summary`, `NTA_API_KEY` not set), 0 FAIL.
`EVAL_TOOLSETS=all` (45 tools listed, typed tools called directly): same result.

## 2026-10-05, `feat/sources-eurostat-ecb-wikidata` rebased on main, local run

Default surface (7 tools listed, every case through `ireland_call`): 26 PASS,
1 SKIP (`nta_get_realtime_summary`, `NTA_API_KEY` not set), 0 FAIL.
New source checks passed: `eurostat_get_data`, `ecb_exchange_rate`,
`wikidata_entity`.

## 2026-10-05, local run (Node 22, Dublin)

| Source | Tool | Result | ms | Note |
|---|---|---|---|---|
| cso | cso_area_profile | PASS | 149 | |
| oireachtas | oireachtas_search_bills | PASS | 364 | |
| geohive | geohive_boundaries_at_point | PASS | 344 | |
| data-gov-ie | datagov_search_datasets | PASS | 151 | |
| smart-dublin | smartdublin_search_datasets | PASS | 239 | |
| met-eireann | met_get_forecast | PASS | 218 | |
| met-eireann | met_get_warnings | PASS | 62 | |
| nta | nta_get_realtime_summary | SKIP | 0 | `NTA_API_KEY` not set locally |
| legislation | legislation_list_acts | PASS | 57 | |
| ppr | ppr_price_stats | PASS | 130 | No index built; used the live per-county CSV fallback |
| irish-rail | rail_get_departures | PASS | 168 | New source; timing from a later run on the same day |
| luas | luas_get_forecast | PASS | 290 | New source; timing from a later run on the same day |
| eirgrid | grid_get_status | PASS | 416 | New source; timing from a later run on the same day |
| marine | marine_get_buoys | PASS | 313 | New source; timing from a later run on the same day |
| opw-water | water_get_level | PASS | 705 | New source; timing from a later run on the same day |
| cross | search | PASS | 658 | |
| cross | ireland_snapshot | PASS | 268 | |

### Defects the first run found (fixed before this run)

1. `oireachtas_search_bills` asked for 500 bills when filtering by title.
   That response is about 5.2MB, which exceeds the 5MB response bound.
   Bill requests are now capped at 250 (about 2.5MB).
2. `legislation_list_acts` returned no Acts for 2025.
   eISB lays out recent year listings over several lines.
   The listing parser now tolerates whitespace between table cells.

Both fixes have regression tests with recorded fixtures.
