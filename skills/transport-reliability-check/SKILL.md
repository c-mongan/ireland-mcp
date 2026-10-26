---
name: transport-reliability-check
description: Takes a live reliability snapshot of Irish public transport - Irish Rail, DART and commuter lateness at a station, Luas arrivals and disruption messages, and, where the server has NTA real-time configured, bus and rail trip cancellations and delays by route - via the Ireland MCP server. Use when someone asks whether trains are running late, if the Luas is disrupted, which bus routes are cancelling trips right now, or wants a quick "is it running" check before travelling.
license: MIT
---

# Transport reliability check

A point-in-time snapshot of how services are running now. It cannot show history or trends; it
only reports what the live feeds return at the moment of the call. Use commute-weather for a
journey plus weather.

**Related projects:** [Ghost Buster](https://realtime.prototype.website/) (Oliver Moran),
[Bus Cancellations Dublin](https://buscancellationsdublin.eu/) (Unknown),
[No-Show Bus Tracker](https://noshowbus.ie/) (Dublin Inquirer),
[Live Dublin Trains](https://www.jake.ie/trains) (Jake McDermott), [EZ Commute IE](https://ezcommute.ie/)
(Rituraj Sambherao). Not affiliated; see [../_shared/inspirations.md](../_shared/inspirations.md).

## Calling the tools

Steps name each operation as source/operation (e.g. `irish-rail/rail_get_departures`), using the typed
tool name as the operation. On the default surface, run it with `ireland_call`, for example:

```json
{ "source": "irish-rail", "operation": "rail_get_departures", "args": { "station": "Connolly", "minutes": 60 } }
```

If an argument shape is unclear, call `ireland_describe` with `{ "source", "operation" }` first;
it returns the schema and an example. `search`, `fetch` and `nearby` are top-level tools. If the
server was added with `?toolsets=<ids>` or `?toolsets=all`, the typed tool can be called directly
with the same `args`.

## Steps

1. **Rail.** Call `irish-rail/rail_find_station` if the station name is ambiguous, then
   `irish-rail/rail_get_departures` with `{ "station", "minutes": 60 }`. Count trains, those with
   `late_min` of 5 or more, and the maximum lateness. Note "No Information" statuses separately.
2. **Luas.** Call `luas/luas_get_forecast` with `{ "stop": "<name or code>" }`. Report the `message`
   verbatim (it carries disruption notices) and the next arrivals each way. Use
   `luas/luas_list_stops` to find a stop code.
3. **Bus and network-wide (if configured).** Call `nta/nta_get_realtime_summary` with `{ "limit": 20 }` for
   routes with the most cancellations and delays. For one route or stop, `nta/nta_get_trip_updates`
   with `route_id` or `stop_id` (a GTFS id, e.g. "8220DB000007"). If the response is
   `NOT_CONFIGURED`, say that live bus data is not available on this server and continue with rail
   and Luas.
4. **Stops near a point (optional).** `tfi-static/tfi_static_search_stops` with `{ "lat", "lon", "radius": 500 }`
   for nearby stop names; NaPTAN AtcoCodes are not guaranteed to equal GTFS stop ids.
5. **Timestamp everything.** Give the time of each call; a snapshot ages within minutes.

## Output format

Illustrative layout; the values are examples, not data.

```
## Running now — 13:38, 26 Oct 2026
**Dublin Connolly (next 60 min):** 8 trains, 1 running ≥5 min late (max 6 min), 1 with no information
**Luas Abbey Street:** "Sunday operating hours & frequency today" — next Connolly 3 min, Saggart 1 min
**Bus (NTA):** not available on this server (NTA real-time not configured)
Sources
- Irish Rail realtime API; TII Luas Forecasting API (CC BY 4.0); NTA GTFS-Realtime (CC BY 4.0)
```

## Rules

- Follow [../_shared/citations.md](../_shared/citations.md); live feeds can be delayed or empty.
- Report counts, not judgements ("unreliable", "ghost bus"). A trip missing from a feed is not proof
  it did not run.
- No historical claims (e.g. "worst this month"); this skill sees only the current snapshot.
