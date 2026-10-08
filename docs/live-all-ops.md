# Live all-operations report

Target: https://func-ireland-mcp-aofsjpwgy4hva.azurewebsites.net/mcp
Generated: 2026-10-07T23:24:03.944Z
Operations: 70 PASS, 2 NOT_CONFIGURED, 2 HOSTED_BLOCKED, 0 FAIL.

Historical hosted limitation (2026-10-07): the Kohesio frontend API returned HTTP 403. The replacement uses packaged dated CSV exports ([details and refresh guide](kohesio-exports.md)); these rows remain the original probe evidence until deployment and a new hosted check. The exports are not live data.

## Default tool exercise

| Tool | Status | Latency ms | Summary |
| --- | --- | ---: | --- |
| ireland_catalogue | PASS | 1131 | rows=7 domains |
| ireland_about | PASS | 1130 | rows=30 |
| search | PASS | 2204 | rows=20 results |
| fetch | PASS | 1136 | id, title, text, url, metadata |
| nearby | PASS | 1399 | rows=4 |
| ireland_describe | PASS | 1128 | source, operation, title, description, input_schema, example |
| ireland_call | PASS | 1140 | rows=2 census |

## Error-path exercise

| Check | Status | Latency ms | Summary |
| --- | --- | ---: | --- |
| error/unknown-operation | PASS | 1131 | NOT_FOUND: Source "cso" has no operation "cso_nope". Hint: Operations for cso: cso_search_tables, cso_get_table_metadata, cso_get_data, cso_area_profile. |
| error/bad-args | PASS | 1126 | BAD_ARGS: Table F1001 has no dimension "NOPE". Hint: Dimensions: STATISTIC (Statistic), TLIST(A1) (CensusYear), C02779V03348 (County), C02199V02655 (Sex). |

## Operations

| Source | Operation | Status | Latency ms | Row count / summary | Date |
| --- | --- | ---: | ---: | --- | --- |
| cso | cso_search_tables | PASS | 1167 | rows=50; truncated | 2026-10-07 |
| cso | cso_get_table_metadata | PASS | 1136 | rows=2106 | 2026-10-07 |
| cso | cso_get_data | PASS | 1152 | rows=10 rows; truncated | 2026-10-07 |
| cso | cso_area_profile | PASS | 1129 | rows=2 census | 2026-10-07 |
| ncse | ncse_search_datasets | PASS | 1139 | rows=10; truncated | 2026-10-07 |
| ncse | ncse_get_dataset | PASS | 1146 | rows=1 formats | 2026-10-07 |
| ncse | ncse_query_datastore | PASS | 1140 | rows=1 | 2026-10-07 |
| eurostat | eurostat_search_datasets | PASS | 1168 | rows=56; truncated | 2026-10-07 |
| eurostat | eurostat_get_data | PASS | 1143 | rows=1 rows | 2026-10-07 |
| eurostat | eurostat_compare_ie_eu | PASS | 1135 | rows=2 geos | 2026-10-07 |
| ecb | ecb_get_series | PASS | 1141 | rows=1 series | 2026-10-07 |
| ecb | ecb_interest_rates | PASS | 1143 | rows=3 rates | 2026-10-07 |
| ecb | ecb_exchange_rate | PASS | 1126 | rows=5 observations | 2026-10-07 |
| pobal | pobal_deprivation_search | PASS | 1135 | rows=2 | 2026-10-07 |
| data-gov-ie | datagov_search_datasets | PASS | 1134 | rows=3070; truncated | 2026-10-07 |
| data-gov-ie | datagov_get_dataset | PASS | 1384 | rows=6 formats; truncated | 2026-10-07 |
| data-gov-ie | datagov_query_datastore | PASS | 1138 | rows=5880; truncated | 2026-10-07 |
| smart-dublin | smartdublin_search_datasets | PASS | 1309 | rows=27; truncated | 2026-10-07 |
| smart-dublin | smartdublin_get_dataset | PASS | 1241 | rows=6 formats; truncated | 2026-10-07 |
| smart-dublin | smartdublin_query_datastore | PASS | 1138 | rows=5880; truncated | 2026-10-07 |
| census-areas | census_small_area_at | PASS | 1145 | lat, lon, area | 2026-10-07 |
| nta | nta_get_realtime_summary | NOT_CONFIGURED | 1131 | NOT_CONFIGURED: NTA real-time data is not configured on this server. Hint: The operator must set the NTA_API_KEY app setting (free key from developer.nationaltransport.ie). | 2026-10-07 |
| nta | nta_get_trip_updates | NOT_CONFIGURED | 1126 | NOT_CONFIGURED: NTA real-time data is not configured on this server. Hint: The operator must set the NTA_API_KEY app setting (free key from developer.nationaltransport.ie). | 2026-10-07 |
| irish-rail | rail_find_station | PASS | 1189 | rows=1 stations | 2026-10-07 |
| irish-rail | rail_get_departures | PASS | 1172 | rows=0 | 2026-10-07 |
| luas | luas_get_forecast | PASS | 1229 | rows=2 inbound | 2026-10-07 |
| luas | luas_list_stops | PASS | 1131 | rows=67 | 2026-10-07 |
| bikes | bikes_networks | PASS | 1399 | rows=5 networks | 2026-10-07 |
| bikes | bikes_stations_near | PASS | 1178 | rows=1 networks_considered | 2026-10-07 |
| met-eireann | met_get_forecast | PASS | 1128 | rows=3 forecast; truncated | 2026-10-07 |
| met-eireann | met_get_observations | PASS | 1333 | rows=11 observations | 2026-10-07 |
| met-eireann | met_get_warnings | PASS | 1270 | rows=4 | 2026-10-07 |
| marine | marine_get_buoys | PASS | 1392 | rows=4 | 2026-10-07 |
| opw-water | water_find_stations | PASS | 1780 | rows=1 | 2026-10-07 |
| opw-water | water_get_level | PASS | 1178 | station, history, note | 2026-10-07 |
| epa | epa_wfd_search | PASS | 1137 | rows=45; truncated | 2026-10-07 |
| epa | epa_wfd_waterbody | PASS | 1140 | rows=5 status_cycles | 2026-10-07 |
| epa | epa_bathing_locations | PASS | 1662 | rows=1 | 2026-10-07 |
| epa | epa_bathing_alerts | PASS | 1203 | rows=1 | 2026-10-07 |
| epa | epa_bathing_measurements | PASS | 1209 | rows=1007; truncated | 2026-10-07 |
| environment-sites | protected_sites_at | PASS | 1153 | rows=0 | 2026-10-07 |
| environment-sites | protected_sites_near | PASS | 1138 | rows=0 | 2026-10-07 |
| eirgrid | grid_get_status | PASS | 1247 | region, demand_mw, demand_time, wind_mw, wind_time, wind_share_pct | 2026-10-07 |
| world-bank | worldbank_get_indicator | PASS | 1619 | rows=66 | 2026-10-07 |
| world-bank | worldbank_ireland_profile | PASS | 1328 | rows=6 indicators | 2026-10-07 |
| cro | cro_search_datasets | PASS | 1150 | rows=2 | 2026-10-07 |
| cro | cro_get_dataset | PASS | 1141 | rows=1 formats | 2026-10-07 |
| cro | cro_query_datastore | PASS | 1141 | rows=825674; truncated | 2026-10-07 |
| kohesio | kohesio_search_projects | HOSTED_BLOCKED | 1901 | UPSTREAM_DOWN: Kohesio returned HTTP 403. Hint: Kohesio blocks some cloud-hosted IPs; run Ireland MCP from a built source checkout with node dist/src/cli.js --toolsets=kohesio (stdio). | 2026-10-07 |
| kohesio | kohesio_get_project | HOSTED_BLOCKED | 1694 | UPSTREAM_DOWN: Kohesio returned HTTP 403. Hint: Kohesio blocks some cloud-hosted IPs; run Ireland MCP from a built source checkout with node dist/src/cli.js --toolsets=kohesio (stdio). | 2026-10-07 |
| ted | ted_search_tenders | PASS | 1153 | rows=292 | 2026-10-07 |
| ted | ted_get_notice | PASS | 1149 | notice, raw | 2026-10-07 |
| oireachtas | oireachtas_search_members | PASS | 1136 | rows=1 | 2026-10-07 |
| oireachtas | oireachtas_search_bills | PASS | 1292 | rows=1 | 2026-10-07 |
| oireachtas | oireachtas_get_debates | PASS | 1249 | rows=8920; truncated | 2026-10-07 |
| oireachtas | oireachtas_search_questions | PASS | 1140 | rows=10000; truncated | 2026-10-07 |
| oireachtas | oireachtas_get_votes | PASS | 1209 | rows=10000; truncated | 2026-10-07 |
| legislation | legislation_list_acts | PASS | 1199 | rows=42; truncated | 2026-10-07 |
| legislation | legislation_get_act | PASS | 1178 | rows=100 sections; truncated | 2026-10-07 |
| legislation | legislation_get_section | PASS | 1134 | act, section, heading, text, eli | 2026-10-07 |
| geohive | geohive_boundaries_at_point | PASS | 1137 | lat, lon, county, local_authority, dail_constituency, local_electoral_area | 2026-10-07 |
| geohive | geohive_locate | PASS | 1137 | rows=1 | 2026-10-07 |
| geohive | geohive_list_layers | PASS | 2277 | rows=0 | 2026-10-07 |
| geohive | geohive_query_layer | PASS | 1137 | rows=3; truncated | 2026-10-07 |
| wikidata | wikidata_place | PASS | 1136 | rows=22; truncated | 2026-10-07 |
| wikidata | wikidata_entity | PASS | 1136 | qid, label, description, irish_name, instance_of, country | 2026-10-07 |
| ppr | ppr_search_sales | PASS | 1873 | rows=318; truncated | 2026-10-07 |
| ppr | ppr_price_stats | PASS | 1153 | rows=4454 | 2026-10-07 |
| planning | planning_search | PASS | 1142 | rows=5; truncated | 2026-10-07 |
| planning | planning_get | PASS | 1137 | rows=1 | 2026-10-07 |
| heritage | heritage_monuments_near | PASS | 1135 | rows=10; truncated | 2026-10-07 |
| cross | list_sources | PASS | 1124 | rows=29 | 2026-10-07 |
| cross | ireland_snapshot | PASS | 1415 | rows=3 | 2026-10-07 |
| cross | nearby | PASS | 1142 | rows=4 | 2026-10-07 |
