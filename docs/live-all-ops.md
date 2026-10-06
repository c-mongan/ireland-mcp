# Live all-operations report

Target: https://func-ireland-mcp-aofsjpwgy4hva.azurewebsites.net/mcp
Generated: 2026-10-06T00:14:57.204Z
Operations: 56 PASS, 2 NOT_CONFIGURED, 0 FAIL.

## Default tool exercise

| Tool | Status | Latency ms | Summary |
| --- | --- | ---: | --- |
| ireland_catalogue | PASS | 1552 | rows=7 domains |
| ireland_about | PASS | 1526 | rows=24 |
| search | PASS | 1726 | rows=20 results |
| fetch | PASS | 1528 | id, title, text, url, metadata |
| nearby | PASS | 1529 | rows=4 |
| ireland_describe | PASS | 1531 | source, operation, title, description, input_schema, example |
| ireland_call | PASS | 1532 | rows=2 census |

## Error-path exercise

| Check | Status | Latency ms | Summary |
| --- | --- | ---: | --- |
| error/unknown-operation | PASS | 1525 | NOT_FOUND: Source "cso" has no operation "cso_nope". Hint: Operations for cso: cso_search_tables, cso_get_table_metadata, cso_get_data, cso_area_profile. |
| error/bad-args | PASS | 1526 | BAD_ARGS: Table F1001 has no dimension "NOPE". Hint: Dimensions: STATISTIC (Statistic), TLIST(A1) (CensusYear), C02779V03348 (County), C02199V02655 (Sex). |

## Operations

| Source | Operation | Status | Latency ms | Row count / summary | Date |
| --- | --- | ---: | ---: | --- | --- |
| cso | cso_search_tables | PASS | 1529 | rows=50; truncated | 2026-10-06 |
| cso | cso_get_table_metadata | PASS | 1531 | rows=2106 | 2026-10-06 |
| cso | cso_get_data | PASS | 1532 | rows=10 rows; truncated | 2026-10-06 |
| cso | cso_area_profile | PASS | 1530 | rows=2 census | 2026-10-06 |
| eurostat | eurostat_search_datasets | PASS | 1572 | rows=56; truncated | 2026-10-06 |
| eurostat | eurostat_get_data | PASS | 1540 | rows=1 rows | 2026-10-06 |
| eurostat | eurostat_compare_ie_eu | PASS | 1530 | rows=2 geos | 2026-10-06 |
| ecb | ecb_get_series | PASS | 1527 | rows=1 series | 2026-10-06 |
| ecb | ecb_interest_rates | PASS | 1527 | rows=3 rates | 2026-10-06 |
| ecb | ecb_exchange_rate | PASS | 1531 | rows=5 observations | 2026-10-06 |
| data-gov-ie | datagov_search_datasets | PASS | 1530 | rows=3069; truncated | 2026-10-06 |
| data-gov-ie | datagov_get_dataset | PASS | 1534 | rows=6 formats; truncated | 2026-10-06 |
| data-gov-ie | datagov_query_datastore | PASS | 1532 | rows=5880; truncated | 2026-10-06 |
| smart-dublin | smartdublin_search_datasets | PASS | 1528 | rows=27; truncated | 2026-10-06 |
| smart-dublin | smartdublin_get_dataset | PASS | 1534 | rows=6 formats; truncated | 2026-10-06 |
| smart-dublin | smartdublin_query_datastore | PASS | 1548 | rows=5880; truncated | 2026-10-06 |
| census-areas | census_small_area_at | PASS | 1538 | lat, lon, area | 2026-10-06 |
| nta | nta_get_realtime_summary | NOT_CONFIGURED | 1527 | NOT_CONFIGURED: NTA real-time data is not configured on this server. Hint: The operator must set the NTA_API_KEY app setting (free key from developer.nationaltransport.ie). | 2026-10-06 |
| nta | nta_get_trip_updates | NOT_CONFIGURED | 1528 | NOT_CONFIGURED: NTA real-time data is not configured on this server. Hint: The operator must set the NTA_API_KEY app setting (free key from developer.nationaltransport.ie). | 2026-10-06 |
| irish-rail | rail_find_station | PASS | 1530 | rows=1 stations | 2026-10-06 |
| irish-rail | rail_get_departures | PASS | 1612 | rows=0 | 2026-10-06 |
| luas | luas_get_forecast | PASS | 1578 | rows=1 inbound | 2026-10-06 |
| luas | luas_list_stops | PASS | 1532 | rows=67 | 2026-10-06 |
| bikes | bikes_networks | PASS | 1529 | rows=5 networks | 2026-10-06 |
| bikes | bikes_stations_near | PASS | 1625 | rows=1 networks_considered | 2026-10-06 |
| met-eireann | met_get_forecast | PASS | 1528 | rows=3 forecast; truncated | 2026-10-06 |
| met-eireann | met_get_observations | PASS | 1524 | rows=1 observations | 2026-10-06 |
| met-eireann | met_get_warnings | PASS | 1589 | rows=0 | 2026-10-06 |
| marine | marine_get_buoys | PASS | 1526 | rows=4 | 2026-10-06 |
| opw-water | water_find_stations | PASS | 1526 | rows=1 | 2026-10-06 |
| opw-water | water_get_level | PASS | 1530 | station, history, note | 2026-10-06 |
| environment-sites | protected_sites_at | PASS | 1522 | rows=0 | 2026-10-06 |
| environment-sites | protected_sites_near | PASS | 1527 | rows=0 | 2026-10-06 |
| eirgrid | grid_get_status | PASS | 2029 | region, demand_mw, demand_time, wind_mw, wind_time, wind_share_pct | 2026-10-06 |
| ted | ted_search_tenders | PASS | 1525 | rows=290 | 2026-10-06 |
| ted | ted_get_notice | PASS | 1527 | notice, raw | 2026-10-06 |
| oireachtas | oireachtas_search_members | PASS | 1548 | rows=1 | 2026-10-06 |
| oireachtas | oireachtas_search_bills | PASS | 1542 | rows=1 | 2026-10-06 |
| oireachtas | oireachtas_get_debates | PASS | 1556 | rows=8918; truncated | 2026-10-06 |
| oireachtas | oireachtas_search_questions | PASS | 1534 | rows=10000; truncated | 2026-10-06 |
| oireachtas | oireachtas_get_votes | PASS | 1533 | rows=10000; truncated | 2026-10-06 |
| legislation | legislation_list_acts | PASS | 1533 | rows=42; truncated | 2026-10-06 |
| legislation | legislation_get_act | PASS | 1534 | rows=100 sections; truncated | 2026-10-06 |
| legislation | legislation_get_section | PASS | 1533 | act, section, heading, text, eli | 2026-10-06 |
| geohive | geohive_boundaries_at_point | PASS | 1531 | lat, lon, county, local_authority, dail_constituency, local_electoral_area | 2026-10-06 |
| geohive | geohive_locate | PASS | 1521 | rows=1 | 2026-10-06 |
| geohive | geohive_list_layers | PASS | 1524 | rows=0 | 2026-10-06 |
| geohive | geohive_query_layer | PASS | 1526 | rows=3; truncated | 2026-10-06 |
| wikidata | wikidata_place | PASS | 1532 | rows=5 | 2026-10-06 |
| wikidata | wikidata_entity | PASS | 1538 | qid, label, description, irish_name, instance_of, country | 2026-10-06 |
| ppr | ppr_search_sales | PASS | 1694 | rows=164; truncated | 2026-10-06 |
| ppr | ppr_price_stats | PASS | 1627 | rows=1777 | 2026-10-06 |
| planning | planning_search | PASS | 1532 | rows=5; truncated | 2026-10-06 |
| planning | planning_get | PASS | 1528 | rows=1 | 2026-10-06 |
| heritage | heritage_monuments_near | PASS | 1525 | rows=10; truncated | 2026-10-06 |
| cross | list_sources | PASS | 1530 | rows=23 | 2026-10-06 |
| cross | ireland_snapshot | PASS | 1533 | rows=3 | 2026-10-06 |
| cross | nearby | PASS | 1533 | rows=4 | 2026-10-06 |
