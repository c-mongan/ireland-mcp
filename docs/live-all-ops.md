# Live all-operations report

Target: https://func-ireland-mcp-aofsjpwgy4hva.azurewebsites.net/mcp
Generated: 2026-10-07T11:24:54.479Z
Operations: 64 PASS, 2 NOT_CONFIGURED, 2 HOSTED_BLOCKED, 0 FAIL.

Known hosted limitation: Kohesio may return HTTP 403 from cloud-hosted IPs. If that happens, run Ireland MCP from a built source checkout with `node dist/src/cli.js --toolsets=kohesio` (stdio).

## Default tool exercise

| Tool | Status | Latency ms | Summary |
| --- | --- | ---: | --- |
| ireland_catalogue | PASS | 1149 | rows=7 domains |
| ireland_about | PASS | 1127 | rows=29 |
| search | PASS | 11134 | rows=20 results |
| fetch | PASS | 1124 | id, title, text, url, metadata |
| nearby | PASS | 1409 | rows=4 |
| ireland_describe | PASS | 1127 | source, operation, title, description, input_schema, example |
| ireland_call | PASS | 1133 | rows=2 census |

## Error-path exercise

| Check | Status | Latency ms | Summary |
| --- | --- | ---: | --- |
| error/unknown-operation | PASS | 1121 | NOT_FOUND: Source "cso" has no operation "cso_nope". Hint: Operations for cso: cso_search_tables, cso_get_table_metadata, cso_get_data, cso_area_profile. |
| error/bad-args | PASS | 1126 | BAD_ARGS: Table F1001 has no dimension "NOPE". Hint: Dimensions: STATISTIC (Statistic), TLIST(A1) (CensusYear), C02779V03348 (County), C02199V02655 (Sex). |

## Operations

| Source | Operation | Status | Latency ms | Row count / summary | Date |
| --- | --- | ---: | ---: | --- | --- |
| cso | cso_search_tables | PASS | 6840 | rows=50; truncated | 2026-10-07 |
| cso | cso_get_table_metadata | PASS | 1127 | rows=2106 | 2026-10-07 |
| cso | cso_get_data | PASS | 1135 | rows=10 rows; truncated | 2026-10-07 |
| cso | cso_area_profile | PASS | 1125 | rows=2 census | 2026-10-07 |
| eurostat | eurostat_search_datasets | PASS | 1165 | rows=56; truncated | 2026-10-07 |
| eurostat | eurostat_get_data | PASS | 1134 | rows=1 rows | 2026-10-07 |
| eurostat | eurostat_compare_ie_eu | PASS | 1131 | rows=2 geos | 2026-10-07 |
| ecb | ecb_get_series | PASS | 1138 | rows=1 series | 2026-10-07 |
| ecb | ecb_interest_rates | PASS | 1142 | rows=3 rates | 2026-10-07 |
| ecb | ecb_exchange_rate | PASS | 1166 | rows=5 observations | 2026-10-07 |
| pobal | pobal_deprivation_search | PASS | 1132 | rows=2 | 2026-10-07 |
| data-gov-ie | datagov_search_datasets | PASS | 1138 | rows=3070; truncated | 2026-10-07 |
| data-gov-ie | datagov_get_dataset | PASS | 1386 | rows=6 formats; truncated | 2026-10-07 |
| data-gov-ie | datagov_query_datastore | PASS | 1140 | rows=5880; truncated | 2026-10-07 |
| smart-dublin | smartdublin_search_datasets | PASS | 1347 | rows=27; truncated | 2026-10-07 |
| smart-dublin | smartdublin_get_dataset | PASS | 1250 | rows=6 formats; truncated | 2026-10-07 |
| smart-dublin | smartdublin_query_datastore | PASS | 1138 | rows=5880; truncated | 2026-10-07 |
| census-areas | census_small_area_at | PASS | 1146 | lat, lon, area | 2026-10-07 |
| nta | nta_get_realtime_summary | NOT_CONFIGURED | 1124 | NOT_CONFIGURED: NTA real-time data is not configured on this server. Hint: The operator must set the NTA_API_KEY app setting (free key from developer.nationaltransport.ie). | 2026-10-07 |
| nta | nta_get_trip_updates | NOT_CONFIGURED | 1124 | NOT_CONFIGURED: NTA real-time data is not configured on this server. Hint: The operator must set the NTA_API_KEY app setting (free key from developer.nationaltransport.ie). | 2026-10-07 |
| irish-rail | rail_find_station | PASS | 1188 | rows=1 stations | 2026-10-07 |
| irish-rail | rail_get_departures | PASS | 1191 | rows=39 | 2026-10-07 |
| luas | luas_get_forecast | PASS | 1191 | rows=8 inbound | 2026-10-07 |
| luas | luas_list_stops | PASS | 1132 | rows=67 | 2026-10-07 |
| bikes | bikes_networks | PASS | 1402 | rows=5 networks | 2026-10-07 |
| bikes | bikes_stations_near | PASS | 1184 | rows=1 networks_considered | 2026-10-07 |
| met-eireann | met_get_forecast | PASS | 1126 | rows=3 forecast; truncated | 2026-10-07 |
| met-eireann | met_get_observations | PASS | 1377 | rows=13 observations | 2026-10-07 |
| met-eireann | met_get_warnings | PASS | 1319 | rows=4 | 2026-10-07 |
| marine | marine_get_buoys | PASS | 1416 | rows=4 | 2026-10-07 |
| opw-water | water_find_stations | PASS | 1793 | rows=1 | 2026-10-07 |
| opw-water | water_get_level | PASS | 1187 | station, history, note | 2026-10-07 |
| epa | epa_wfd_search | PASS | 1137 | rows=45; truncated | 2026-10-07 |
| epa | epa_wfd_waterbody | PASS | 1134 | rows=5 status_cycles | 2026-10-07 |
| environment-sites | protected_sites_at | PASS | 1144 | rows=0 | 2026-10-07 |
| environment-sites | protected_sites_near | PASS | 1142 | rows=0 | 2026-10-07 |
| eirgrid | grid_get_status | PASS | 1425 | region, demand_mw, demand_time, wind_mw, wind_time, wind_share_pct | 2026-10-07 |
| world-bank | worldbank_get_indicator | PASS | 1459 | rows=66 | 2026-10-07 |
| world-bank | worldbank_ireland_profile | PASS | 1330 | rows=6 indicators | 2026-10-07 |
| cro | cro_search_datasets | PASS | 1150 | rows=2 | 2026-10-07 |
| cro | cro_get_dataset | PASS | 1129 | rows=1 formats | 2026-10-07 |
| cro | cro_query_datastore | PASS | 1133 | rows=825674; truncated | 2026-10-07 |
| kohesio | kohesio_search_projects | HOSTED_BLOCKED | 1363 | UPSTREAM_DOWN: Kohesio returned HTTP 403. Hint: Kohesio blocks some cloud-hosted IPs; run Ireland MCP from a built source checkout with node dist/src/cli.js --toolsets=kohesio (stdio). | 2026-10-07 |
| kohesio | kohesio_get_project | HOSTED_BLOCKED | 1220 | UPSTREAM_DOWN: Kohesio returned HTTP 403. Hint: Kohesio blocks some cloud-hosted IPs; run Ireland MCP from a built source checkout with node dist/src/cli.js --toolsets=kohesio (stdio). | 2026-10-07 |
| ted | ted_search_tenders | PASS | 1142 | rows=291 | 2026-10-07 |
| ted | ted_get_notice | PASS | 1138 | notice, raw | 2026-10-07 |
| oireachtas | oireachtas_search_members | PASS | 1129 | rows=1 | 2026-10-07 |
| oireachtas | oireachtas_search_bills | PASS | 1318 | rows=1 | 2026-10-07 |
| oireachtas | oireachtas_get_debates | PASS | 1230 | rows=8919; truncated | 2026-10-07 |
| oireachtas | oireachtas_search_questions | PASS | 1136 | rows=10000; truncated | 2026-10-07 |
| oireachtas | oireachtas_get_votes | PASS | 1233 | rows=10000; truncated | 2026-10-07 |
| legislation | legislation_list_acts | PASS | 1151 | rows=42; truncated | 2026-10-07 |
| legislation | legislation_get_act | PASS | 1168 | rows=100 sections; truncated | 2026-10-07 |
| legislation | legislation_get_section | PASS | 1127 | act, section, heading, text, eli | 2026-10-07 |
| geohive | geohive_boundaries_at_point | PASS | 1124 | lat, lon, county, local_authority, dail_constituency, local_electoral_area | 2026-10-07 |
| geohive | geohive_locate | PASS | 1130 | rows=1 | 2026-10-07 |
| geohive | geohive_list_layers | PASS | 2585 | rows=0 | 2026-10-07 |
| geohive | geohive_query_layer | PASS | 1135 | rows=3; truncated | 2026-10-07 |
| wikidata | wikidata_place | PASS | 1138 | rows=5 | 2026-10-07 |
| wikidata | wikidata_entity | PASS | 1133 | qid, label, description, irish_name, instance_of, country | 2026-10-07 |
| ppr | ppr_search_sales | PASS | 1135 | rows=318; truncated | 2026-10-07 |
| ppr | ppr_price_stats | PASS | 1152 | rows=4454 | 2026-10-07 |
| planning | planning_search | PASS | 1141 | rows=5; truncated | 2026-10-07 |
| planning | planning_get | PASS | 1136 | rows=1 | 2026-10-07 |
| heritage | heritage_monuments_near | PASS | 1132 | rows=10; truncated | 2026-10-07 |
| cross | list_sources | PASS | 1214 | rows=28 | 2026-10-07 |
| cross | ireland_snapshot | PASS | 1145 | rows=3 | 2026-10-07 |
| cross | nearby | PASS | 1150 | rows=4 | 2026-10-07 |
