---
name: compare-two-areas
description: Compares two Irish places side by side (census population and change, Pobal deprivation by electoral division, recent Property Price Register sale prices, RTB average rents and local boundaries) using the Ireland MCP server, with every figure cited. Use when someone asks "how does X compare with Y", wants Ballymun versus Tallaght, Galway versus Limerick, or two counties, towns or electoral divisions put side by side.
license: MIT
---

# Compare two areas

Build a side-by-side, sourced comparison of two places in Ireland. Use irish-area-report instead
for a single place, and where-to-live-shortlist when the user wants to rank three or more places.

**Related projects:** [IrelandInsights](https://irelandinsights.ie/) (IrelandInsights),
[Civgraph](https://civgraph.net/) (Scott Moore), [Ireland Property Price Atlas](https://propertypriceireland.com)
(Ireland Property Price Atlas). Not affiliated; see [../_shared/inspirations.md](../_shared/inspirations.md).

## Calling the tools

Steps name each operation as source/operation (e.g. `pobal/pobal_deprivation_search`), using the typed
tool name as the operation. On the default surface, run it with `ireland_call`, for example:

```json
{ "source": "pobal", "operation": "pobal_deprivation_search", "args": { "query": "Ballymun" } }
```

If an argument shape is unclear, call `ireland_describe` with `{ "source", "operation" }` first;
it returns the schema and an example. `search`, `fetch`, `nearby` and `ireland_resolve_place` are top-level tools. If the
server was added with `?toolsets=<ids>` or `?toolsets=all`, the typed tool can be called directly
with the same `args`.

## Steps

1. **Pin both places to the same level.** Compare like with like: county with county, council with
   council, LEA with LEA, electoral division (ED) with ED. Call `ireland_resolve_place` with
   `{ "place": "Tallaght" }` for each place. It returns `place.level` and every code: county, local
   authority, LEA, Dáil constituency, NUTS3 and the ED `code` (six digits, e.g. "268018"). For an area,
   add `"list": "ed"` to get all of its EDs. A town name falls back to its gazetteer point, which is
   flagged `approximate`. If the levels differ, tell the user and pick the closest common level.
2. **Population.** Call `cso/cso_area_profile` with `{ "area": "<county or town>", "years": ["2016", "2022"] }`.
   Counties give change between censuses; towns give Census 2022 only.
3. **Deprivation.** Call `pobal/pobal_deprivation_search` with `{ "query": "<ED code>" }` (the code from
   step 1 matches Pobal's `ed_id`) for each ED from step 1. A name can match several EDs (Ballymun A–F);
   list each or give a population-weighted average, and say which.
4. **Sale prices.** Call `ppr/ppr_price_stats` for each place over the same 12 months, e.g.
   `{ "county": "Dublin", "address": "tallaght", "from": "<12 months ago>" }` or an Eircode routing key
   (`"eircode": "D24"`). Report median, count and quartiles.
5. **Rents (optional).** Call `cso/cso_get_table_metadata` with `{ "table_code": "RIQ02" }` to find the
   Location codes, then `cso/cso_get_data` with `{ "table_code": "RIQ02", "filters": { "C03004V03625": ["<loc>"],
   "C02970V03592": ["-"], "C02969V03591": ["-"], "TLIST(Q1)": ["<latest quarter>"] } }`.
   RTB locations are counties, towns and Dublin postal districts (e.g. "Dublin 24"); say if a place has no RTB row.
6. **Compute differences** only from returned values (absolute and %), and show the arithmetic.

## Output format

Illustrative layout; the values are examples, not data.

```
## Tallaght vs Ballymun
| Measure | Tallaght | Ballymun | Period | Source |
|---|---|---|---|---|
| Electoral divisions | Tallaght-Jobstown, ... | Ballymun A–F | 2022 boundaries | CSO / Tailte Éireann |
| Pobal relative index | -8.1 (Disadvantaged) | -21.6 to -9.3 | 2022 | Pobal HP Index |
| Median sale price | €365,000 (n=410) | €310,000 (n=96) | Oct 2025–Sep 2026 | PPR, data as of DATE |
| RTB average rent | €1,950 | €1,880 | 2025Q4 | RTB via CSO RIQ02 |
Sources
- ...
```

## Rules

- Follow [../_shared/citations.md](../_shared/citations.md): every number has its period and source.
- Use the same period and level for both places; flag any mismatch in the table.
- No "better" or "worse" verdicts and no advice on where to live. Describe differences only.
- Pobal scores are relative to the national mean (0); negative means more disadvantaged than average.
- Small PPR counts (under 20 sales) are unstable; say so next to the median.
