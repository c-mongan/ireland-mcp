---
name: energy-and-grid-explainer
description: Explains Ireland's electricity system with live and official figures - current demand, wind generation, wind share and carbon intensity from the EirGrid Smart Grid Dashboard, renewable share of electricity for Ireland versus the EU from Eurostat, and CSO energy tables - via the Ireland MCP server. Use when someone asks how windy the grid is now, how green Irish electricity is, how Ireland compares with the EU on renewables, or wants context for an energy news story.
license: MIT
---

# Energy and grid explainer

Pair the live grid snapshot with official annual statistics so a "right now" figure is never
mistaken for a yearly one. Use grid-now for just the live snapshot.

**Related projects:** [Smart Grid Dashboard](https://www.smartgriddashboard.com/all/) (EirGrid Group plc),
[Green Collective](https://www.greencollective.io/) (Johnston & Wang Green Collective KlG). Not
affiliated; see [../_shared/inspirations.md](../_shared/inspirations.md).

## Calling the tools

Steps name each operation as source/operation (e.g. `eirgrid/grid_get_status`), using the typed tool name
as the operation. On the default surface, run it with `ireland_call`, for example:

```json
{ "source": "eirgrid", "operation": "grid_get_status", "args": { "region": "ROI" } }
```

If an argument shape is unclear, call `ireland_describe` with `{ "source", "operation" }` first;
it returns the schema and an example. `search`, `fetch` and `nearby` are top-level tools. If the
server was added with `?toolsets=<ids>` or `?toolsets=all`, the typed tool can be called directly
with the same `args`.

## Steps

1. **Now.** Call `eirgrid/grid_get_status` with `{ "region": "ROI" }` (or "ALL" for the island, "NI").
   Report demand (MW), wind (MW), wind share (%) and CO2 intensity (gCO2/kWh), each with its own
   timestamp. Pass on any `note` about missing early-morning readings.
2. **This year vs the EU.** Call `eurostat/eurostat_compare_ie_eu` with
   `{ "dataset": "nrg_ind_ren", "filters": { "nrg_bal": ["REN_ELC"] }, "since": "2019" }` for the share of
   electricity from renewables, Ireland vs EU27. Use "REN" for the overall renewable energy share.
   Mark provisional values (`status: "p"`).
3. **Weather link (optional).** `met-eireann/met_get_forecast` for a windy-region point (e.g. Belmullet
   54.23, -10.0) or `marine/marine_get_buoys` for offshore wind, to explain a high or low wind share.
4. **More detail (optional).** `cso/cso_search_tables` with "electricity" or "energy" (e.g. MEG01 metered
   generation by fuel) and `cso/cso_get_data`; or `eurostat/eurostat_search_datasets` for other energy tables.
5. **Explain.** One or two sentences linking the numbers: e.g. a high wind share at a low-demand hour
   says nothing about the annual share.

## Output format

Illustrative layout; the values are examples, not data.

```
## Irish electricity, 26 Oct 2026
**Now (EirGrid, ROI):** demand 4,358 MW, wind 3,385 MW = 77.7% at 13:30; CO2 154 g/kWh at 23:45 (25 Oct)
**Renewables share of electricity (Eurostat nrg_ind_ren):** Ireland 41.x% vs EU27 47.5% (2024)
<2–3 sentence explanation>
Sources
- EirGrid Smart Grid Dashboard (real-time, provisional)
- Eurostat nrg_ind_ren (Eurostat reuse policy), retrieved <date>
```

## Rules

- Follow [../_shared/citations.md](../_shared/citations.md).
- EirGrid real-time data is provisional and can lag; give each value's own timestamp.
- Never compare a live percentage with an annual percentage as if they were the same measure.
- No energy-saving, tariff or investment advice.
