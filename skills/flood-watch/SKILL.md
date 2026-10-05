---
name: flood-watch
description: Watches river and lake levels from the OPW hydrometric network (waterlevel.ie), Met Éireann weather warnings and rainfall forecasts, and Marine Institute weather buoys through the Ireland MCP server, to describe current water-level trends near an Irish place. Use when someone asks whether a river is rising, about flood risk after heavy rain, or about sea conditions off the Irish coast. Not an official flood warning service.
license: MIT
---

# Flood watch

Describe what the gauges and forecasts show now. Do not issue warnings.

## Calling the tools

Steps name each operation as source/operation (e.g. `ppr/ppr_price_stats`), using the typed tool name as the operation. On the
default surface, run it with `ireland_call`, for example:

```json
{ "source": "opw-water", "operation": "water_find_stations", "args": { "query": "Athlone" } }
```

If an argument shape is unclear, call `ireland_describe` with `{ "source", "operation" }` first;
it returns the schema and an example. `search`, `fetch` and `nearby` are top-level tools. If the
server was added with `?toolsets=<ids>` or `?toolsets=all`, the typed tool (e.g. `water_find_stations`) can
be called directly with the same `args`.


## Steps

1. **Find gauges.** Call `opw-water/water_find_stations` with `{ "query": "Athlone" }` (a town,
   river or 5-digit station ref). Pick 1–3 relevant stations.
2. **Read levels.** Call `opw-water/water_get_level` with `{ "station": "<name or ref>", "hours": 36 }`.
   Report the latest level, the change over the window and its direction (rising, falling, steady).
3. **Warnings.** Call `met-eireann/met_get_warnings` with `{}` and keep rain, wind and coastal
   warnings for the area's counties.
4. **Rain ahead.** Call `met-eireann/met_get_forecast` with the station's `lat`/`lon` and `"hours": 24`;
   total the forecast rainfall.
5. **Coast** (optional): call `marine/marine_get_buoys` (or `{ "buoy": "M2" }`) for wave height and wind.
6. Combine into a short factual summary.

## Output format

```
**Shannon at Athlone, as of 09:00 (OPW):** 1.82 m, up 0.14 m in 36 h (rising).
Met Éireann: Yellow rain warning for Westmeath until 21:00. ~18 mm forecast next 24 h.
| Station | Latest | 36 h change | Trend | Time |
|---|---|---|---|---|
Official updates: met.ie, waterlevel.ie, floodinfo.ie, your local authority.
Sources
- OPW hydrometric data, waterlevel.ie (CC BY 4.0), provisional, retrieved 09:05
- Met Éireann (CC BY 4.0)
```

## Rules

- Follow [../_shared/citations.md](../_shared/citations.md). Every reading has its time.
- **Not an official flood warning.** Never say an area will or will not flood. Point to
  Met Éireann, the OPW (floodinfo.ie) and the local authority for warnings and safety advice.
- OPW levels are provisional and relative to the station's own datum; do not compare raw levels
  between stations.
- Copy Met Éireann warning levels exactly. If a gauge feed is missing, say so.
