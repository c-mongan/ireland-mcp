# Live all-operations report

Target: local stdio dist/src/cli.js
Generated: 2026-10-06T00:26:13.384Z
Operations: 66 PASS, 2 NOT_CONFIGURED, 0 HOSTED_BLOCKED, 0 FAIL.

Known hosted limitation: Kohesio may return HTTP 403 from cloud-hosted IPs. If that happens, run Ireland MCP locally with npx/stdio for Kohesio.

## Default tool exercise

| Tool | Status | Latency ms | Summary |
| --- | --- | ---: | --- |
| ireland_catalogue | PASS | 2 | rows=7 domains |
| ireland_about | PASS | 0 | rows=29 |
| search | PASS | 1416 | rows=20 results |
| fetch | PASS | 43 | id, title, text, url, metadata |
| nearby | PASS | 535 | rows=4 |
| ireland_describe | PASS | 3 | source, operation, title, description, input_schema, example |
| ireland_call | PASS | 849 | rows=2 census |

## Error-path exercise

| Check | Status | Latency ms | Summary |
| --- | --- | ---: | --- |
| error/unknown-operation | PASS | 0 | NOT_FOUND: Source "cso" has no operation "cso_nope". Hint: Operations for cso: cso_search_tables, cso_get_table_metadata, cso_get_data, cso_area_profile. |
| error/bad-args | PASS | 1 | BAD_ARGS: Table F1001 has no dimension "NOPE". Hint: Dimensions: STATISTIC (Statistic), TLIST(A1) (CensusYear), C02779V03348 (County), C02199V02655 (Sex). |

## Operations

| Source | Operation | Status | Latency ms | Row count / summary | Date |
| --- | --- | ---: | ---: | --- | --- |
| cso | cso_search_tables | PASS | 196 | rows=50; truncated | 2026-10-06 |
| cso | cso_get_table_metadata | PASS | 3 | rows=2106 | 2026-10-06 |
| cso | cso_get_data | PASS | 76 | rows=10 rows; truncated | 2026-10-06 |
| cso | cso_area_profile | PASS | 2 | rows=2 census | 2026-10-06 |
| eurostat | eurostat_search_datasets | PASS | 32 | rows=56; truncated | 2026-10-06 |
| eurostat | eurostat_get_data | PASS | 76 | rows=1 rows | 2026-10-06 |
| eurostat | eurostat_compare_ie_eu | PASS | 67 | rows=2 geos | 2026-10-06 |
| ecb | ecb_get_series | PASS | 160 | rows=1 series | 2026-10-06 |
| ecb | ecb_interest_rates | PASS | 275 | rows=3 rates | 2026-10-06 |
| ecb | ecb_exchange_rate | PASS | 2 | rows=5 observations | 2026-10-06 |
| pobal | pobal_deprivation_search | PASS | 59 | rows=2 | 2026-10-06 |
| data-gov-ie | datagov_search_datasets | PASS | 88 | rows=3069; truncated | 2026-10-06 |
| data-gov-ie | datagov_get_dataset | PASS | 101 | rows=6 formats; truncated | 2026-10-06 |
| data-gov-ie | datagov_query_datastore | PASS | 71 | rows=5880; truncated | 2026-10-06 |
| smart-dublin | smartdublin_search_datasets | PASS | 140 | rows=27; truncated | 2026-10-06 |
| smart-dublin | smartdublin_get_dataset | PASS | 66 | rows=6 formats; truncated | 2026-10-06 |
| smart-dublin | smartdublin_query_datastore | PASS | 68 | rows=5880; truncated | 2026-10-06 |
| census-areas | census_small_area_at | PASS | 312 | lat, lon, area | 2026-10-06 |
| nta | nta_get_realtime_summary | NOT_CONFIGURED | 3 | NOT_CONFIGURED: NTA real-time data is not configured on this server. Hint: The operator must set the NTA_API_KEY app setting (free key from developer.nationaltransport.ie). | 2026-10-06 |
| nta | nta_get_trip_updates | NOT_CONFIGURED | 2 | NOT_CONFIGURED: NTA real-time data is not configured on this server. Hint: The operator must set the NTA_API_KEY app setting (free key from developer.nationaltransport.ie). | 2026-10-06 |
| irish-rail | rail_find_station | PASS | 88 | rows=1 stations | 2026-10-06 |
| irish-rail | rail_get_departures | PASS | 26 | rows=0 | 2026-10-06 |
| luas | luas_get_forecast | PASS | 990 | rows=0 inbound | 2026-10-06 |
| luas | luas_list_stops | PASS | 2 | rows=67 | 2026-10-06 |
| bikes | bikes_networks | PASS | 238 | rows=5 networks | 2026-10-06 |
| bikes | bikes_stations_near | PASS | 35 | rows=1 networks_considered | 2026-10-06 |
| met-eireann | met_get_forecast | PASS | 3 | rows=3 forecast; truncated | 2026-10-06 |
| met-eireann | met_get_observations | PASS | 193 | rows=2 observations | 2026-10-06 |
| met-eireann | met_get_warnings | PASS | 42 | rows=0 | 2026-10-06 |
| marine | marine_get_buoys | PASS | 246 | rows=4 | 2026-10-06 |
| opw-water | water_find_stations | PASS | 518 | rows=1 | 2026-10-06 |
| opw-water | water_get_level | PASS | 14 | station, history, note | 2026-10-06 |
| epa | epa_wfd_search | PASS | 122 | rows=45; truncated | 2026-10-06 |
| epa | epa_wfd_waterbody | PASS | 40 | rows=5 status_cycles | 2026-10-06 |
| environment-sites | protected_sites_at | PASS | 278 | rows=0 | 2026-10-06 |
| environment-sites | protected_sites_near | PASS | 2701 | rows=0 | 2026-10-06 |
| eirgrid | grid_get_status | PASS | 860 | region, demand_mw, demand_time, wind_mw, wind_time, wind_share_pct | 2026-10-06 |
| world-bank | worldbank_get_indicator | PASS | 222 | rows=66 | 2026-10-06 |
| world-bank | worldbank_ireland_profile | PASS | 209 | rows=6 indicators | 2026-10-06 |
| cro | cro_search_datasets | PASS | 119 | rows=2 | 2026-10-06 |
| cro | cro_get_dataset | PASS | 56 | rows=1 formats | 2026-10-06 |
| cro | cro_query_datastore | PASS | 214 | rows=825674; truncated | 2026-10-06 |
| kohesio | kohesio_search_projects | PASS | 484 | rows=20; truncated | 2026-10-06 |
| kohesio | kohesio_get_project | PASS | 718 | rows=1 beneficiaries | 2026-10-06 |
| ted | ted_search_tenders | PASS | 144 | rows=290 | 2026-10-06 |
| ted | ted_get_notice | PASS | 96 | notice, raw | 2026-10-06 |
| oireachtas | oireachtas_search_members | PASS | 2 | rows=1 | 2026-10-06 |
| oireachtas | oireachtas_search_bills | PASS | 145 | rows=1 | 2026-10-06 |
| oireachtas | oireachtas_get_debates | PASS | 79 | rows=8918; truncated | 2026-10-06 |
| oireachtas | oireachtas_search_questions | PASS | 18 | rows=10000; truncated | 2026-10-06 |
| oireachtas | oireachtas_get_votes | PASS | 19 | rows=10000; truncated | 2026-10-06 |
| legislation | legislation_list_acts | PASS | 52 | rows=42; truncated | 2026-10-06 |
| legislation | legislation_get_act | PASS | 49 | rows=100 sections; truncated | 2026-10-06 |
| legislation | legislation_get_section | PASS | 3 | act, section, heading, text, eli | 2026-10-06 |
| geohive | geohive_boundaries_at_point | PASS | 1 | lat, lon, county, local_authority, dail_constituency, local_electoral_area | 2026-10-06 |
| geohive | geohive_locate | PASS | 118 | rows=1 | 2026-10-06 |
| geohive | geohive_list_layers | PASS | 1015 | rows=0 | 2026-10-06 |
| geohive | geohive_query_layer | PASS | 71 | rows=3; truncated | 2026-10-06 |
| wikidata | wikidata_place | PASS | 84 | rows=5 | 2026-10-06 |
| wikidata | wikidata_entity | PASS | 29 | qid, label, description, irish_name, instance_of, country | 2026-10-06 |
| ppr | ppr_search_sales | PASS | 143 | rows=164; truncated | 2026-10-06 |
| ppr | ppr_price_stats | PASS | 5 | rows=1777 | 2026-10-06 |
| planning | planning_search | PASS | 525 | rows=5; truncated | 2026-10-06 |
| planning | planning_get | PASS | 471 | rows=1 | 2026-10-06 |
| heritage | heritage_monuments_near | PASS | 410 | rows=10; truncated | 2026-10-06 |
| cross | list_sources | PASS | 2 | rows=28 | 2026-10-06 |
| cross | ireland_snapshot | PASS | 379 | rows=3 | 2026-10-06 |
| cross | nearby | PASS | 5 | rows=4 | 2026-10-06 |
