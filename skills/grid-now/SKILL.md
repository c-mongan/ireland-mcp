---
name: grid-now
description: Reports the current state of the Irish electricity grid from the EirGrid Smart Grid Dashboard through the Ireland MCP server, including demand, wind and renewable share, generation, CO2 intensity and interconnector flows for Ireland, Northern Ireland or the whole island. Use when someone asks how windy or green the grid is now, what demand is, or whether now is a lower-carbon time to run appliances.
license: MIT
---

# Grid now

Snapshot of the all-island electricity system right now.

## Calling the tools

Each step names a **source** and an **op** as `source.op`. With the default lean surface, call
`ireland_call` with `source`, `op` and `args`, and run `ireland_describe(source, op)` first if you
are unsure of the arguments. If typed toolsets are enabled (`?toolsets=...`, or a server that
lists typed tools), call the op name directly as a tool with the same arguments.


## Steps

1. Pick the region: `ALL` (whole island, default), `ROI` (Republic) or `NI` (Northern Ireland).
2. Call `eirgrid.grid_get_status` with `{ "region": "ALL" }`.
3. Report the latest values with their own timestamps: `demand_mw`, `wind_mw`, `wind_share_pct`
   and `co2_g_per_kwh` (each has a `*_time` field; CO2 is often older than demand). Use only fields
   that are present.
4. The tool returns the latest reading, not a history. If asked "is now a good time", report the
   current wind share and CO2 intensity factually; do not claim a trend or forecast.
5. For weather context (windy day?), optionally call `met-eireann.met_get_forecast` for a point.

## Output format

```
**All-island grid at 14:15 (EirGrid):** demand 4,920 MW, wind 2,310 MW (47%), CO2 190 g/kWh.
| Measure | Value | Time |
|---|---|---|
Sources
- EirGrid Smart Grid Dashboard, retrieved 14:17. Data are provisional.
```

## Rules

- Follow [../_shared/citations.md](../_shared/citations.md). Always show the data timestamp.
- EirGrid dashboard values are provisional and can be revised; say so.
- Use the units the tool returns (MW, %, gCO2/kWh). Do not convert to bills or costs.
- No energy-trading or financial advice.
