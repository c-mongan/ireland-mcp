---
name: housing-supply-tracker
description: Tracks housing supply and affordability for an Irish local authority or local electoral area by combining CSO new dwelling completions (by local authority and LEA), CSO/ESB vacancy rates, RTB average rents, Property Price Register sale prices including new homes, and recent planning applications, via the Ireland MCP server. Use when someone asks how many homes were built in their council area, whether completions are keeping up, how rents and prices moved alongside supply, or which LEAs had the most or fewest completions.
license: MIT
---

# Housing supply tracker

Line up supply (completions, vacancy, planning) against prices and rents for one area over the same
years. It reports indicators side by side; it does not model demand or need.

**Related projects:** [One Million Homes](https://onemillionhomes.ie/) (Rob Cass, Edward Dixon),
[House Price Ireland](https://housepriceireland.ie/) (Unknown), [EireEstate](https://www.eireestate.ie/)
(Evegny Koltsov). Not affiliated; see [../_shared/inspirations.md](../_shared/inspirations.md).

## Calling the tools

Steps name each operation as source/operation (e.g. `cso/cso_get_data`), using the typed tool name as
the operation. On the default surface, run it with `ireland_call`, for example:

```json
{ "source": "cso", "operation": "cso_get_data", "args": { "table_code": "NDQ05", "filters": { "TLIST(Q1)": ["20251", "20252"] } } }
```

If an argument shape is unclear, call `ireland_describe` with `{ "source", "operation" }` first;
it returns the schema and an example. `search`, `fetch` and `nearby` are top-level tools. If the
server was added with `?toolsets=<ids>` or `?toolsets=all`, the typed tool can be called directly
with the same `args`.

## Tables

| Indicator | Table | Geography | Time |
|---|---|---|---|
| New dwelling completions | NDQ05 (by house type: NDQ06) | Local authority | Quarter |
| New dwelling completions | NDA05 / NDQ09 | Local electoral area | Year / Quarter |
| Vacant dwellings and vacancy rate | VAC14 / VAC15 | Local authority / LEA | Q4 each year |
| RTB average monthly rent | RIQ02 | County, town, Dublin area | Quarter |

## Steps

1. **Name the area.** For an address, `geohive/geohive_boundaries_at_point` gives local authority and
   LEA. Keep exact names (e.g. "Galway City Council", "Galway City West").
2. **Codes.** Call `cso/cso_get_table_metadata` for each table and note the area's category code
   (local authority codes look like "2ae19629-...") and the latest periods.
3. **Completions.** `cso/cso_get_data` on NDQ05 (or NDA05 for an LEA) filtered to the area and the last
   8 quarters or 5 years. Sum quarters into calendar years only when all four are present.
4. **Vacancy.** `cso/cso_get_data` on VAC14 (or VAC15) for the area: vacant dwellings, dwelling stock
   and vacancy rate.
5. **Rents.** `cso/cso_get_data` on RIQ02 with all bedrooms ("-"), all property types ("-") and the
   area's Location code, for the same years.
6. **Prices.** `ppr/ppr_price_stats` for each year (`from`/`to`), once with `"property": "new"` and once with
   `"property": "second-hand"`. Each result also reports `new_count` and `second_hand_count`.
7. **Pipeline (optional).** `planning/planning_search` with `{ "council", "text": "houses", "from" }` to list
   recent large residential applications; counts here are applications, not permissions or homes.
8. **Ranking across LEAs (optional).** Fetch NDA05 for all LEAs in one council, sort by completions and
   show the full list, not just the top or bottom.

## Output format

Illustrative layout; the values are examples, not data.

```
## Galway City Council: supply and prices
| Year | Completions (NDQ05) | Vacancy rate Q4 (VAC14) | Avg rent (RIQ02) | Median sale (PPR) |
|---|---|---|---|---|
Sources
- CSO tables NDQ05, VAC14, RIQ02 (CC BY 4.0; RTB data hosted by CSO); PPR data as of DATE
```

## Rules

- Follow [../_shared/citations.md](../_shared/citations.md) and its PPR caveats.
- Completions are ESB connections, not planning permissions or commencements; vacancy is based on
  low electricity use. Say both once.
- No statements that an area "needs" a number of homes; that is outside these data.
- PPR new-home prices exclude VAT.
