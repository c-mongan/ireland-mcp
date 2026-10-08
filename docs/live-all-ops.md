# Live all-operations report

Target: https://func-ireland-mcp-aofsjpwgy4hva.azurewebsites.net/mcp
Generated: 2026-10-08T09:22:04.676Z
Operations: 72 PASS, 2 NOT_CONFIGURED, 0 HOSTED_BLOCKED, 0 FAIL.

Kohesio answers come from packaged, dated official Irish CSV exports (not live data); see [kohesio-exports.md](kohesio-exports.md).

## Default tool exercise

| Tool | Status | Latency ms | Summary |
| --- | --- | ---: | --- |
| ireland_catalogue | PASS | 1132 | rows=7 domains |
| ireland_about | PASS | 1130 | rows=30 |
| search | PASS | 6134 | rows=20 results |
| fetch | PASS | 1427 | id, title, text, url, metadata |
| nearby | PASS | 1563 | rows=4 |
| ireland_describe | PASS | 1124 | source, operation, title, description, input_schema, example |
| ireland_call | PASS | 1229 | rows=2 census |

## Error-path exercise

| Check | Status | Latency ms | Summary |
| --- | --- | ---: | --- |
| error/unknown-operation | PASS | 1160 | NOT_FOUND: Source "cso" has no operation "cso_nope". Hint: Operations for cso: cso_search_tables, cso_get_table_metadata, cso_get_data, cso_area_profile. |
| error/bad-args | PASS | 1139 | BAD_ARGS: Table F1001 has no dimension "NOPE". Hint: Dimensions: STATISTIC (Statistic), TLIST(A1) (CensusYear), C02779V03348 (County), C02199V02655 (Sex). |

## Operations

| Source | Operation | Status | Latency ms | Row count / summary | Date |
| --- | --- | ---: | ---: | --- | --- |
| cso | cso_search_tables | PASS | 7046 | rows=50; truncated | 2026-10-08 |
| cso | cso_get_table_metadata | PASS | 1126 | rows=2106 | 2026-10-08 |
| cso | cso_get_data | PASS | 1260 | rows=10 rows; truncated | 2026-10-08 |
| cso | cso_area_profile | PASS | 1136 | rows=2 census | 2026-10-08 |
| ncse | ncse_search_datasets | PASS | 1270 | rows=10; truncated | 2026-10-08 |
| ncse | ncse_get_dataset | PASS | 1222 | rows=1 formats | 2026-10-08 |
| ncse | ncse_query_datastore | PASS | 1282 | rows=1 | 2026-10-08 |
| eurostat | eurostat_search_datasets | PASS | 1182 | rows=56; truncated | 2026-10-08 |
| eurostat | eurostat_get_data | PASS | 1138 | rows=1 rows | 2026-10-08 |
| eurostat | eurostat_compare_ie_eu | PASS | 1137 | rows=2 geos | 2026-10-08 |
| ecb | ecb_get_series | PASS | 1374 | rows=1 series | 2026-10-08 |
| ecb | ecb_interest_rates | PASS | 1484 | rows=3 rates | 2026-10-08 |
| ecb | ecb_exchange_rate | PASS | 1126 | rows=5 observations | 2026-10-08 |
| pobal | pobal_deprivation_search | PASS | 1261 | rows=2 | 2026-10-08 |
| data-gov-ie | datagov_search_datasets | PASS | 1217 | rows=3070; truncated | 2026-10-08 |
| data-gov-ie | datagov_get_dataset | PASS | 1257 | rows=6 formats; truncated | 2026-10-08 |
| data-gov-ie | datagov_query_datastore | PASS | 1238 | rows=5880; truncated | 2026-10-08 |
| smart-dublin | smartdublin_search_datasets | PASS | 1317 | rows=27; truncated | 2026-10-08 |
| smart-dublin | smartdublin_get_dataset | PASS | 1242 | rows=6 formats; truncated | 2026-10-08 |
| smart-dublin | smartdublin_query_datastore | PASS | 1220 | rows=5880; truncated | 2026-10-08 |
| census-areas | census_small_area_at | PASS | 5144 | lat, lon, area | 2026-10-08 |
| nta | nta_get_realtime_summary | NOT_CONFIGURED | 1127 | NOT_CONFIGURED: NTA real-time data is not configured on this server. Hint: The operator must set the NTA_API_KEY app setting (free key from developer.nationaltransport.ie). | 2026-10-08 |
| nta | nta_get_trip_updates | NOT_CONFIGURED | 1128 | NOT_CONFIGURED: NTA real-time data is not configured on this server. Hint: The operator must set the NTA_API_KEY app setting (free key from developer.nationaltransport.ie). | 2026-10-08 |
| irish-rail | rail_find_station | PASS | 1185 | rows=1 stations | 2026-10-08 |
| irish-rail | rail_get_departures | PASS | 1178 | rows=40 | 2026-10-08 |
| luas | luas_get_forecast | PASS | 1386 | rows=8 inbound | 2026-10-08 |
| luas | luas_list_stops | PASS | 1129 | rows=67 | 2026-10-08 |
| bikes | bikes_networks | PASS | 1602 | rows=5 networks | 2026-10-08 |
| bikes | bikes_stations_near | PASS | 1178 | rows=1 networks_considered | 2026-10-08 |
| met-eireann | met_get_forecast | PASS | 1135 | rows=3 forecast; truncated | 2026-10-08 |
| met-eireann | met_get_observations | PASS | 1349 | rows=11 observations | 2026-10-08 |
| met-eireann | met_get_warnings | PASS | 1270 | rows=5 | 2026-10-08 |
| marine | marine_get_buoys | PASS | 1478 | rows=4 | 2026-10-08 |
| opw-water | water_find_stations | PASS | 1862 | rows=1 | 2026-10-08 |
| opw-water | water_get_level | PASS | 1172 | station, history, note | 2026-10-08 |
| epa | epa_wfd_search | PASS | 1938 | rows=45; truncated | 2026-10-08 |
| epa | epa_wfd_waterbody | PASS | 3011 | rows=5 status_cycles | 2026-10-08 |
| epa | epa_bathing_locations | PASS | 2752 | rows=1 | 2026-10-08 |
| epa | epa_bathing_alerts | PASS | 1442 | rows=1 | 2026-10-08 |
| epa | epa_bathing_measurements | PASS | 1555 | rows=1008; truncated | 2026-10-08 |
| environment-sites | protected_sites_at | PASS | 2431 | rows=0 | 2026-10-08 |
| environment-sites | protected_sites_near | PASS | 6247 | rows=0 | 2026-10-08 |
| eirgrid | grid_get_status | PASS | 1608 | region, demand_mw, demand_time, wind_mw, wind_time, wind_share_pct | 2026-10-08 |
| world-bank | worldbank_get_indicator | PASS | 1351 | rows=66 | 2026-10-08 |
| world-bank | worldbank_ireland_profile | PASS | 1853 | rows=6 indicators | 2026-10-08 |
| cro | cro_search_datasets | PASS | 1331 | rows=2 | 2026-10-08 |
| cro | cro_get_dataset | PASS | 1211 | rows=1 formats | 2026-10-08 |
| cro | cro_query_datastore | PASS | 1316 | rows=825674; truncated | 2026-10-08 |
| kohesio | kohesio_search_projects | PASS | 1135 | rows=139; truncated | 2026-10-08 |
| kohesio | kohesio_get_project | PASS | 1150 | rows=1 beneficiaries | 2026-10-08 |
| ted | ted_search_tenders | PASS | 2092 | rows=292 | 2026-10-08 |
| ted | ted_get_notice | PASS | 2124 | notice, raw | 2026-10-08 |
| oireachtas | oireachtas_search_members | PASS | 1131 | rows=1 | 2026-10-08 |
| oireachtas | oireachtas_search_bills | PASS | 1279 | rows=1 | 2026-10-08 |
| oireachtas | oireachtas_get_debates | PASS | 1243 | rows=8920; truncated | 2026-10-08 |
| oireachtas | oireachtas_search_questions | PASS | 1204 | rows=10000; truncated | 2026-10-08 |
| oireachtas | oireachtas_get_votes | PASS | 1184 | rows=10000; truncated | 2026-10-08 |
| legislation | legislation_list_acts | PASS | 1176 | rows=42; truncated | 2026-10-08 |
| legislation | legislation_get_act | PASS | 1174 | rows=100 sections; truncated | 2026-10-08 |
| legislation | legislation_get_section | PASS | 1129 | act, section, heading, text, eli | 2026-10-08 |
| geohive | geohive_boundaries_at_point | PASS | 1127 | lat, lon, county, local_authority, dail_constituency, local_electoral_area | 2026-10-08 |
| geohive | geohive_locate | PASS | 1247 | rows=1 | 2026-10-08 |
| geohive | geohive_list_layers | PASS | 2327 | rows=0 | 2026-10-08 |
| geohive | geohive_query_layer | PASS | 1259 | rows=3; truncated | 2026-10-08 |
| wikidata | wikidata_place | PASS | 1143 | rows=22; truncated | 2026-10-08 |
| wikidata | wikidata_entity | PASS | 1138 | qid, label, description, irish_name, instance_of, country | 2026-10-08 |
| ppr | ppr_search_sales | PASS | 1926 | rows=320; truncated | 2026-10-08 |
| ppr | ppr_price_stats | PASS | 1139 | rows=4500 | 2026-10-08 |
| planning | planning_search | PASS | 1989 | rows=5; truncated | 2026-10-08 |
| planning | planning_get | PASS | 1501 | rows=1 | 2026-10-08 |
| heritage | heritage_monuments_near | PASS | 2163 | rows=10; truncated | 2026-10-08 |
| cross | list_sources | PASS | 1133 | rows=29 | 2026-10-08 |
| cross | ireland_snapshot | PASS | 1419 | rows=3 | 2026-10-08 |
| cross | nearby | PASS | 1130 | rows=4 | 2026-10-08 |
