---
name: flood-watch
description: Watches river and lake levels from the OPW hydrometric network (waterlevel.ie), Met Éireann weather warnings and rainfall forecasts, and Marine Institute weather buoys through the Ireland MCP server, to describe current water-level trends near an Irish place. Use when someone asks whether a river is rising, about flood risk after heavy rain, or about sea conditions off the Irish coast. Not an official flood warning service.
license: MIT
---

# Flood watch

Describe what the gauges and forecasts show now. Do not issue warnings.

## Calling the tools

Each step names a **source** and an **op** as `source.op`. With the default lean surface, call
`ireland_call` with `source`, `op` and `args`, and run `ireland_describe(source, op)` first if you
are unsure of the arguments. If typed toolsets are enabled (`?toolsets=...`, or a server that
lists typed tools), call the op name directly as a tool with the same arguments.


## Steps

1. **Find gauges.** Call `opw-water.water_find_stations` with `{ "query": "Athlone" }` (a town,
   river or 5-digit station ref). Pick 1–3 relevant stations.
2. **Read levels.** Call `opw-water.water_get_level` with `{ "station": "<name or ref>", "hours": 36 }`.
   Report the latest level, the change over the window and its direction (rising, falling, steady).
3. **Warnings.** Call `met-eireann.met_get_warnings` with `{}` and keep rain, wind and coastal
   warnings for the area's counties.
4. **Rain ahead.** Call `met-eireann.met_get_forecast` with the station's `lat`/`lon` and `"hours": 24`;
   total the forecast rainfall.
5. **Coast** (optional): call `marine.marine_get_buoys` (or `{ "buoy": "M2" }`) for wave height and wind.
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
