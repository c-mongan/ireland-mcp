---
name: commute-weather
description: Gives a live Irish commute check combining Irish Rail departures, Luas tram forecasts, NTA bus/rail realtime delays, and the Met Éireann forecast and weather warnings through the Ireland MCP server. Use when someone asks when the next train or Luas is, whether their commute is disrupted, or whether to expect rain or wind on the way to work or school in Ireland.
license: MIT
---

# Commute and weather check

Answer "how is my journey looking right now?" with live, timestamped data.

## Calling the tools

Each step names a **source** and an **op** as `source.op`. With the default lean surface, call
`ireland_call` with `source`, `op` and `args`, and run `ireland_describe(source, op)` first if you
are unsure of the arguments. If typed toolsets are enabled (`?toolsets=...`, or a server that
lists typed tools), call the op name directly as a tool with the same arguments.


## Steps

1. **Ask for or infer** the start stop/station, mode and rough time. Default to "now".
2. **Train (DART, commuter, intercity).** Call `irish-rail.rail_find_station` with `{ "query": "Bray" }`
   to get the exact name, then `irish-rail.rail_get_departures` with `{ "station": "Bray", "minutes": 60 }`.
3. **Luas.** If unsure of the stop, call `luas.luas_list_stops` with `{ "line": "Green" }`, then
   `luas.luas_get_forecast` with `{ "stop": "Ranelagh" }`.
4. **Bus and other NTA services.** Call `nta.nta_get_trip_updates` with a `route_id` or `stop_id` if
   known, or `nta.nta_get_realtime_summary` for a network-wide view of delays and cancellations.
5. **Weather.** Call `met-eireann.met_get_forecast` with the start point `lat`/`lon` and `hours`
   (e.g. 3), and `met-eireann.met_get_warnings` with `{}`. Mention only warnings covering the route's counties.
6. Summarise in one line first, then the detail.

## Output format

```
**Bray → city, as of 08:12:** next DART 08:19 (on time), then 08:34 (+4 min). Light rain, 9°C, no warnings.

| Due | Service | Destination | Status |
|---|---|---|---|
| 08:19 | DART | Howth | on time |

Weather (Met Éireann, issued 07:00): 9°C, rain 0.4 mm/h, wind 25 km/h SW.
Sources
- Irish Rail realtime API, retrieved 08:12
- Met Éireann (CC BY 4.0), forecast issued 07:00
```

## Rules

- Follow [../_shared/citations.md](../_shared/citations.md). Every time is "as of" the retrieval time.
- Live feeds can lag or be empty. If a feed returns nothing, say "no live data" rather than "no services".
- Copy warning levels exactly (Yellow/Orange/Red). No safety advice beyond pointing to met.ie and the operator.
- Never invent timetable data from memory.
