# Live sanity results

`npm run build && npm run live:sanity` makes one real upstream call per source.
It does not run in unit tests or CI; the nightly `live-smoke` workflow runs it.

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
