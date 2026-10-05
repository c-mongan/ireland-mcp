---
name: irish-area-report
description: Builds a cited one-page profile of an Irish county, town or point (population from the CSO census, administrative boundaries from Tailte Éireann GeoHive, recent house sale prices from the Property Price Register, and the Met Éireann forecast and warnings) using the Ireland MCP server. Use when someone asks "what is X like", wants an area overview before moving, visiting or writing about a place in Ireland, or needs the county, constituency or electoral division for a location.
license: MIT
---

# Irish area report

Produce a short, sourced profile of one place in Ireland.

## Calling the tools

Steps name each operation as source/operation (e.g. `ppr/ppr_price_stats`), using the typed tool name as the operation. On the
default surface, run it with `ireland_call`, for example:

```json
{ "source": "cross", "operation": "ireland_snapshot", "args": { "place": "Athlone" } }
```

If an argument shape is unclear, call `ireland_describe` with `{ "source", "operation" }` first;
it returns the schema and an example. `search`, `fetch` and `nearby` are top-level tools. If the
server was added with `?toolsets=<ids>` or `?toolsets=all`, the typed tool (e.g. `ireland_snapshot`) can
be called directly with the same `args`.

## Steps

1. **Resolve the place.**
   - County or large town: call `cross/ireland_snapshot` with `{ "place": "Athlone" }`.
     It returns county, census population, boundaries, forecast and national warnings in one call.
   - Exact point (lat/lon, or the place is not in the built-in list): call `cross/nearby` with
     `{ "lat": 53.27, "lon": -9.05 }`, or `geohive/geohive_boundaries_at_point` for boundaries only.
   - If the snapshot says the place is not found, ask for a nearby town or coordinates. Do not guess.
2. **Population.** Call `cso/cso_area_profile` with `{ "area": "<county>", "years": ["2016", "2022"] }`
   to show change between censuses. Census areas are counties (Dublin may be split; use the label returned).
3. **Boundaries.** Report county, local authority, Dáil constituency, electoral division and small
   area from the GeoHive block. For other layers, use `geohive/geohive_list_layers` then
   `geohive/geohive_query_layer`.
4. **House prices.** Call `ppr/ppr_price_stats` with `{ "county": "<county>", "from": "<12 months ago>" }`.
   Narrow with `address` (a town word) or `eircode` (routing key such as "H91"). Keep `from`–`to`
   within 3 years. See the house-price-check skill for caveats.
5. **Weather.** Use the forecast and warnings from step 1, or `met-eireann/met_get_forecast` and
   `met-eireann/met_get_warnings`.
6. Optional extras, only if asked: TDs for the constituency via `oireachtas/oireachtas_search_members`
   with `{ "constituency": "<name>" }`; transport via the commute-weather skill.

## Output format

Illustrative layout; the values are examples, not data.

```
## <Place>, Co. <County>
| Topic | Figure | Period | Source |
|---|---|---|---|
| Population | 84,447 | Census 2022 | CSO F1001 |
| Change since 2016 | +5.1% | 2016–2022 | CSO F1001 |
| Median sale price | €315,000 (n=1,204) | Oct 2025–Sep 2026 | PPR, data as of DATE |
| Constituency | Galway West | current boundaries | GeoHive |
| Weather next 6h | 12°C, showers | issued TIME | Met Éireann |
| Active warnings | Yellow wind (Galway) | until TIME | Met Éireann |

<2–4 sentence plain-English summary>

Sources
- ...
```

## Rules

- Follow [../_shared/citations.md](../_shared/citations.md): every number has its period and source.
- Say "not available" for a failed section and keep the rest. Never fill gaps from memory.
- No advice on whether to buy, rent or move. Describe the data only.
- Field notes and example values: [references/fields.md](references/fields.md).
