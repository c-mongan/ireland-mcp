---
name: where-to-live-shortlist
description: Builds a cited comparison matrix for a shortlist of Irish towns or areas someone is considering living in, combining Property Price Register sale prices, RTB rents, Pobal deprivation, nearby public-transport stops and rail stations, river gauges and Met Éireann warnings, and special-education school allocations, via the Ireland MCP server. Use when someone asks where to live, wants to shortlist towns within reach of a city, or compares three or more places on cost, transport and local context.
license: MIT
---

# Where-to-live shortlist

Put two to six candidate places in one matrix so the user can weigh them. The skill describes data;
it never recommends a place. Use compare-two-areas for exactly two places and house-price-check for
detailed sales in one area.

**Related projects:** [HomeTrue](https://hometrue.ie/) (Unknown), [HousePrice.ie](https://houseprice.ie/)
(u/hungry475), [PropertyLab](https://propertylab.ie/) (u/dylgarr),
[Property Price Register API](https://priceregister.civictech.ie/) (CivicTech.ie). Not affiliated; see
[../_shared/inspirations.md](../_shared/inspirations.md).

## Calling the tools

Steps name each operation as source/operation (e.g. `ppr/ppr_price_stats`), using the typed tool name
as the operation. On the default surface, run it with `ireland_call`, for example:

```json
{ "source": "ppr", "operation": "ppr_price_stats", "args": { "county": "Kildare", "address": "maynooth", "from": "2025-10-01" } }
```

If an argument shape is unclear, call `ireland_describe` with `{ "source", "operation" }` first;
it returns the schema and an example. `search`, `fetch` and `nearby` are top-level tools. If the
server was added with `?toolsets=<ids>` or `?toolsets=all`, the typed tool can be called directly
with the same `args`.

## Steps

1. **Agree the criteria.** Ask (once) which columns matter: price, rent, transport, deprivation,
   schools, river levels. Default to price, rent and transport. Cap the list at six places.
2. **Locate each place.** Call `ireland_resolve_place` with `{ "place": "Maynooth" }`. Keep the county,
   local authority, LEA, constituency and ED `code` from `codes`, and `match.lat`/`match.lon` when the
   place resolved through the gazetteer. For a council or LEA instead of a town, use a gazetteer point
   from `geohive/geohive_locate` for the transport step.
3. **Prices.** Call `ppr/ppr_price_stats` with `{ "county", "address": "<town word>", "from": "<12 months ago>" }`.
   Use the same window for every place.
4. **Rents.** Use `cso/cso_get_table_metadata` on RIQ02 to find each place's Location code, then
   `cso/cso_get_data` with `{ "table_code": "RIQ02", "filters": { "C03004V03625": ["<loc>"], "C02970V03592": ["-"],
   "C02969V03591": ["-"], "TLIST(Q1)": ["<latest quarter>"] } }`. Mark "no RTB row" when missing.
5. **Transport.** Call `tfi-static/tfi_static_search_stops` with `{ "lat", "lon", "radius": 800 }` and count
   active stops; call `irish-rail/rail_find_station` with the town name for a station code. Stop counts
   are not frequencies or journey times; say so.
6. **Deprivation.** Call `pobal/pobal_deprivation_search` with `{ "query": "<ED code>" }`.
7. **Schools (optional).** Call `ncse/ncse_search_datasets` with `{ "query": "school allocations" }`, take the
   latest year's primary or post-primary resource id from `ncse/ncse_get_dataset`, then
   `ncse/ncse_query_datastore` with `{ "resource_id", "q": "<town>" }`. This lists schools whose name
   or county matches, with special-education allocations; it is not a full school directory.
8. **Water and weather context (optional).** `opw-water/water_find_stations` with a river or town name,
   and `met-eireann/met_get_warnings`. These are live readings, not flood-risk maps; point to
   floodinfo.ie for flood maps.
9. **If the user gives weights,** compute a score only from the matrix values, show the formula and
   each input, and keep the unweighted matrix beside it.

## Output format

Illustrative layout; the values are examples, not data.

```
| Place | Median sale (n) | Avg rent | Stops ≤800 m | Rail | Pobal (ED) | Source dates |
|---|---|---|---|---|---|---|
| Maynooth | €505,000 (175) | €2,050 | 14 | MYNTH | +4.2 Marginally above avg | PPR as of DATE; RTB 2025Q4 |
| Kilcock | ... | ... | ... | ... | ... | ... |
Sources
- ...
```

## Rules

- Follow [../_shared/citations.md](../_shared/citations.md) and its PPR caveats.
- No recommendation, ranking or "best place" claims unless the user supplied the weights.
- Same time window and method for every place; note any place with thin data.
- No safety, school-quality or flood-risk judgements: these sources do not measure them.
