# Live all-operations report

Target: https://mcp.irishopendata.ie/mcp
Generated: 2026-10-26T01:09:18.575Z
Operations: 78 PASS, 3 NOT_CONFIGURED, 0 HOSTED_BLOCKED, 0 DEGRADED, 1 FAIL.

Kohesio answers come from packaged, dated official Irish CSV exports (not live data); see [kohesio-exports.md](kohesio-exports.md).

## Default tool exercise

| Tool | Status | Latency ms | Summary |
| --- | --- | ---: | --- |
| ireland_catalogue | PASS | 1165 | rows=7 domains |
| ireland_about | PASS | 1136 | rows=37 |
| search | PASS | 6295 | rows=20 results |
| fetch | PASS | 1509 | id, title, text, url, metadata |
| nearby | PASS | 1643 | rows=4 |
| ireland_describe | PASS | 1184 | source, operation, title, description, input_schema, example |
| ireland_call | PASS | 1620 | rows=2 census |

## Error-path exercise

| Check | Status | Latency ms | Summary |
| --- | --- | ---: | --- |
| error/unknown-operation | PASS | 1125 | Source "cso" has no operation "cso_nope". |
| error/bad-args | PASS | 1177 | Result does not identify the requested operation. |

## Operations

| Source | Operation | Status | Latency ms | Row count / summary | Date |
| --- | --- | ---: | ---: | --- | --- |
| cso | cso_search_tables | PASS | 1497 | rows=50; truncated | 2026-10-26 |
| cso | cso_get_table_metadata | PASS | 1182 | rows=2106 | 2026-10-26 |
| cso | cso_get_data | PASS | 1268 | rows=10 rows; truncated | 2026-10-26 |
| cso | cso_area_profile | PASS | 1224 | rows=2 census | 2026-10-26 |
| ncse | ncse_search_datasets | PASS | 1328 | rows=11; truncated | 2026-10-26 |
| ncse | ncse_get_dataset | PASS | 1260 | rows=1 formats | 2026-10-26 |
| ncse | ncse_query_datastore | PASS | 1247 | rows=1 | 2026-10-26 |
| eurostat | eurostat_search_datasets | PASS | 1220 | rows=55; truncated | 2026-10-26 |
| eurostat | eurostat_get_data | PASS | 1432 | rows=1 rows | 2026-10-26 |
| eurostat | eurostat_compare_ie_eu | PASS | 1298 | rows=2 geos | 2026-10-26 |
| ecb | ecb_get_series | PASS | 1360 | rows=1 series | 2026-10-26 |
| ecb | ecb_interest_rates | PASS | 1328 | rows=3 rates | 2026-10-26 |
| ecb | ecb_exchange_rate | PASS | 1176 | rows=5 observations | 2026-10-26 |
| pobal | pobal_deprivation_search | PASS | 1380 | rows=2 | 2026-10-26 |
| data-gov-ie | datagov_search_datasets | PASS | 1281 | rows=3066; truncated | 2026-10-26 |
| data-gov-ie | datagov_get_dataset | PASS | 1341 | rows=6 formats; truncated | 2026-10-26 |
| data-gov-ie | datagov_query_datastore | PASS | 1263 | rows=5880; truncated | 2026-10-26 |
| smart-dublin | smartdublin_search_datasets | PASS | 1394 | rows=27; truncated | 2026-10-26 |
| smart-dublin | smartdublin_get_dataset | PASS | 1298 | rows=6 formats; truncated | 2026-10-26 |
| smart-dublin | smartdublin_query_datastore | PASS | 1286 | rows=5880; truncated | 2026-10-26 |
| census-areas | census_small_area_at | PASS | 1744 | lat, lon, area | 2026-10-26 |
| nta | nta_get_realtime_summary | NOT_CONFIGURED | 1174 | NOT_CONFIGURED: NTA real-time data is not configured on this server. Hint: The operator must set the NTA_API_KEY app setting (free key from developer.nationaltransport.ie). | 2026-10-26 |
| nta | nta_get_trip_updates | NOT_CONFIGURED | 1178 | NOT_CONFIGURED: NTA real-time data is not configured on this server. Hint: The operator must set the NTA_API_KEY app setting (free key from developer.nationaltransport.ie). | 2026-10-26 |
| irish-rail | rail_find_station | PASS | 1297 | rows=1 stations | 2026-10-26 |
| irish-rail | rail_get_departures | PASS | 1243 | rows=0 | 2026-10-26 |
| luas | luas_get_forecast | PASS | 1511 | rows=0 inbound | 2026-10-26 |
| luas | luas_list_stops | PASS | 1181 | rows=67 | 2026-10-26 |
| bikes | bikes_networks | PASS | 1535 | rows=5 networks | 2026-10-26 |
| bikes | bikes_stations_near | PASS | 1316 | rows=1 networks_considered | 2026-10-26 |
| tfi-static | tfi_static_search_stops | PASS | 2259 | rows=15; truncated | 2026-10-26 |
| met-eireann | met_get_forecast | PASS | 1177 | rows=3 forecast; truncated | 2026-10-26 |
| met-eireann | met_get_observations | PASS | 1400 | rows=1 observations | 2026-10-26 |
| met-eireann | met_get_warnings | PASS | 1178 | rows=7 | 2026-10-26 |
| marine | marine_get_buoys | PASS | 1421 | rows=4 | 2026-10-26 |
| opw-water | water_find_stations | PASS | 1736 | rows=1 | 2026-10-26 |
| opw-water | water_get_level | PASS | 1312 | station, history, note | 2026-10-26 |
| epa | epa_wfd_search | PASS | 1347 | rows=45; truncated | 2026-10-26 |
| epa | epa_wfd_waterbody | PASS | 1378 | rows=5 status_cycles | 2026-10-26 |
| epa | epa_bathing_locations | PASS | 2082 | rows=1 | 2026-10-26 |
| epa | epa_bathing_alerts | PASS | 1541 | rows=0 | 2026-10-26 |
| epa | epa_bathing_measurements | PASS | 1536 | rows=1016; truncated | 2026-10-26 |
| environment-sites | protected_sites_at | PASS | 2498 | rows=0 | 2026-10-26 |
| environment-sites | protected_sites_near | PASS | 6313 | rows=0 | 2026-10-26 |
| gsi | groundwater_vulnerability_at | PASS | 2177 | rows=1 areas | 2026-10-26 |
| eirgrid | grid_get_status | FAIL | 1319 | Domain sample failed its acceptance check: grid_get_status. | 2026-10-26 |
| paygap | paygap_search_reports | PASS | 2006 | rows=1 reports | 2026-10-26 |
| council-budgets | council_budgets_list_years | PASS | 1180 | rows=14 years | 2026-10-26 |
| council-budgets | council_budgets_get | PASS | 2099 | rows=20 rows; truncated | 2026-10-26 |
| world-bank | worldbank_get_indicator | PASS | 1429 | rows=66 | 2026-10-26 |
| world-bank | worldbank_ireland_profile | PASS | 1399 | rows=6 indicators | 2026-10-26 |
| cro | cro_search_datasets | PASS | 1462 | rows=2 | 2026-10-26 |
| cro | cro_get_dataset | PASS | 1236 | rows=1 formats | 2026-10-26 |
| cro | cro_query_datastore | PASS | 1406 | rows=827846; truncated | 2026-10-26 |
| kohesio | kohesio_search_projects | PASS | 1182 | rows=139; truncated | 2026-10-26 |
| kohesio | kohesio_get_project | PASS | 1180 | rows=1 beneficiaries | 2026-10-26 |
| ted | ted_search_tenders | PASS | 1568 | rows=292 | 2026-10-26 |
| ted | ted_get_notice | PASS | 1405 | notice, raw | 2026-10-26 |
| lobbying | lobbying_search_returns | PASS | 1318 | rows=1438; truncated | 2026-10-26 |
| oireachtas | oireachtas_search_members | PASS | 1262 | rows=1 | 2026-10-26 |
| oireachtas | oireachtas_search_bills | PASS | 1377 | rows=1 | 2026-10-26 |
| oireachtas | oireachtas_get_debates | PASS | 1389 | rows=8926; truncated | 2026-10-26 |
| oireachtas | oireachtas_search_questions | PASS | 1357 | rows=10000; truncated | 2026-10-26 |
| oireachtas | oireachtas_get_votes | PASS | 1254 | rows=10000; truncated | 2026-10-26 |
| legislation | legislation_list_acts | PASS | 1223 | rows=42; truncated | 2026-10-26 |
| legislation | legislation_get_act | PASS | 1311 | rows=100 sections; truncated | 2026-10-26 |
| legislation | legislation_get_section | PASS | 1184 | act, section, heading, text, eli | 2026-10-26 |
| geohive | geohive_boundaries_at_point | PASS | 1180 | lat, lon, county, local_authority, dail_constituency, local_electoral_area | 2026-10-26 |
| geohive | geohive_locate | PASS | 1607 | rows=1 | 2026-10-26 |
| geohive | geohive_list_layers | PASS | 2204 | rows=0 | 2026-10-26 |
| geohive | geohive_query_layer | PASS | 1362 | rows=3; truncated | 2026-10-26 |
| wikidata | wikidata_place | PASS | 1785 | rows=22; truncated | 2026-10-26 |
| wikidata | wikidata_entity | PASS | 2096 | qid, label, description, irish_name, instance_of, country | 2026-10-26 |
| ppr | ppr_search_sales | PASS | 2255 | rows=326; truncated | 2026-10-26 |
| ppr | ppr_price_stats | PASS | 1193 | rows=4586 | 2026-10-26 |
| planning | planning_search | PASS | 1796 | rows=5; truncated | 2026-10-26 |
| planning | planning_get | PASS | 1618 | rows=1 | 2026-10-26 |
| heritage | heritage_monuments_near | PASS | 1544 | rows=10; truncated | 2026-10-26 |
| failte-ireland | failte_search | PASS | 2305 | rows=504; truncated | 2026-10-26 |
| logainm | logainm_search_places | NOT_CONFIGURED | 1178 | NOT_CONFIGURED: Logainm is not configured on this server. Hint: The operator must register at the Gaois Developer Hub and set LOGAINM_API_KEY. See https://docs.gaois.ie/en/data/getting-started. | 2026-10-26 |
| cross | list_sources | PASS | 1217 | rows=36 | 2026-10-26 |
| cross | ireland_snapshot | PASS | 1478 | rows=3 | 2026-10-26 |
| cross | nearby | PASS | 1217 | rows=4 | 2026-10-26 |
