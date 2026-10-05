---
name: cso-chart
description: Finds a Central Statistics Office (CSO) PxStat table through the Ireland MCP server, pulls a filtered slice of it and turns it into a chart-ready table plus a chart spec (Vega-Lite or a Markdown table) with full citation. Use when someone wants official Irish statistics (population, prices, CPI, employment, housing, migration, etc.) charted or tabulated over time or across areas.
license: MIT
---

# CSO chart

Turn a question into a correctly filtered CSO table and a simple chart.

## Calling the tools

Steps name each operation as source/operation (e.g. `ppr/ppr_price_stats`), using the typed tool name as the operation. On the
default surface, run it with `ireland_call`, for example:

```json
{ "source": "cso", "operation": "cso_search_tables", "args": { "query": "consumer price index", "limit": 10 } }
```

If an argument shape is unclear, call `ireland_describe` with `{ "source", "operation" }` first;
it returns the schema and an example. `search`, `fetch` and `nearby` are top-level tools. If the
server was added with `?toolsets=<ids>` or `?toolsets=all`, the typed tool (e.g. `cso_search_tables`) can
be called directly with the same `args`.


## Steps

1. **Find the table.** Call `cso/cso_search_tables` with `{ "query": "consumer price index", "limit": 10 }`.
   Pick the table whose title, frequency and date range fit. Tell the user the code you chose.
2. **Read the dimensions.** Call `cso/cso_get_table_metadata` with `{ "table_code": "CPM01" }`.
   Note each dimension code (statistic, time, area, etc.) and the category codes you need.
3. **Pull a small slice.** Call `cso/cso_get_data` with `table_code` and `filters` mapping dimension
   codes to arrays of category codes, e.g. `{ "table_code": "F1001", "filters": { "<dim code>": ["<cat code>"] } }`.
   Always filter: requests over 10,000 cells are rejected. Keep `limit` modest (≤500).
4. For census population by county, `cso/cso_area_profile` is a shortcut.
5. **Shape the data** into rows of `{ period, series, value, unit }`. Keep the unit from the table.
6. **Chart.** Choose: line for time series, bar for areas/categories. Emit a Vega-Lite spec (see
   [references/vega-lite.md](references/vega-lite.md)) or, if the client cannot render charts, a Markdown table.

## Output format

```
### <Table title> (<table code>), <series>, <first>–<last period>
<chart spec or table>
Notes: <unit>, <base period if an index>, <provisional flags>.
Sources
- CSO, table <code> "<title>" (CC BY 4.0), last updated <date from metadata>, retrieved <date>: <url>
```

## Rules

- Follow [../_shared/citations.md](../_shared/citations.md). Title the chart with the table code and period.
- Never mix tables or units in one series. Never extrapolate or forecast.
- If an index, state the base period (e.g. Dec 2023 = 100).
- If the right table is unclear, show the top 3 candidates and ask.
