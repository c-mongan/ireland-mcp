# Field notes for irish-area-report

## cross.ireland_snapshot
- Input: `place` (county or large town in the built-in list) or `lat` + `lon`.
- Returns `place`, `county`, `population` (CSO F1001 rows), `boundaries` (GeoHive), `nearest_met_station`,
  `forecast`, `national_warnings` and a `sources` array. Copy the `sources` array into your Sources list.
- If the place is unknown the error hint lists valid names.

## cross.nearby
- Input: `lat`, `lon`, `hours` (1–48, default 6). Same boundaries and forecast, no population.

## cso.cso_area_profile
- Input: `area` (county name, F1001 county code, `State`, or a Census 2022 town such as `Ennis`), optional `years` (county census years such as "2016", "2022").
- Counties come from CSO table F1001 (`level: "county"`, with change). Towns come from F1015 (`level: "town"`, 2022 only, with average age and age bands; `change` is null).
- An ambiguous town name (e.g. `Milltown`) returns BAD_ARGS listing the full names to retry with.

## ppr.ppr_price_stats
- Input filters: `county`, `address`, `eircode`, `from`, `to`, `min_price`, `max_price`,
  `property` (`any` | `new` | `second-hand`), `include_non_market` (default false).
- Returns count, median, mean and quartiles. Quote the count with the median.

## geohive.geohive_query_layer
- Input: `service` (from `geohive/geohive_list_layers`), `where` (ArcGIS SQL, default `1=1`),
  `out_fields`, `order_by`, `limit`.
