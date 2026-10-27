---
name: planning-and-heritage-near-me
description: Lists what is recorded around an Irish address or point - recent planning applications from the National Planning Application Database, recorded monuments from the National Monuments Service Sites and Monuments Record, NPWS protected sites (SAC, SPA, NHA), GSI groundwater vulnerability and the containing boundaries - via the Ireland MCP server. Use when someone asks what is being built near them, whether a site has monuments or protected habitats nearby, or wants a planning and heritage check before buying, objecting or visiting.
license: MIT
---

# Planning and heritage near me

A radius check around one point: planning activity, recorded heritage and environmental
designations. This is a desk screen, not a planning or legal opinion.

**Related projects:** [PlanningRegister.ie](https://planningregister.ie/) (John McEnroe),
[Monumental Ireland](https://monumentalireland.ie/) (Monumental Ireland),
[Discover Alone](https://discoveralone.com/) (Rickie Doherty). Not affiliated; see
[../_shared/inspirations.md](../_shared/inspirations.md).

## Calling the tools

Steps name each operation as source/operation (e.g. `planning/planning_search`), using the typed tool
name as the operation. On the default surface, run it with `ireland_call`, for example:

```json
{ "source": "planning", "operation": "planning_search", "args": { "lat": 53.2707, "lon": -9.0568, "radius_m": 500, "from": "2025-01-01" } }
```

If an argument shape is unclear, call `ireland_describe` with `{ "source", "operation" }` first;
it returns the schema and an example. `search`, `fetch` and `nearby` are top-level tools. If the
server was added with `?toolsets=<ids>` or `?toolsets=all`, the typed tool can be called directly
with the same `args`.

## Steps

1. **Get a point.** From a place name, `geohive/geohive_locate`; from coordinates, use them directly.
   An Eircode alone cannot be geocoded here; ask for a nearby place or coordinates.
2. **Boundaries in one call.** Call `nearby` with `{ "lat", "lon" }` for county, local authority,
   monuments within 500 m and protected sites at the point. Use it as the summary line.
3. **Planning.** Call `planning/planning_search` with `{ "lat", "lon", "radius_m": 500, "from": "<2 years ago>" }`.
   Report reference, council, received date, decision (if present) and a one-line description.
   For one application, call `planning/planning_get` with `{ "application_ref", "council" }`.
   Each result has the exact `total`; page with `offset`. For "how many, and how many homes", call
   `planning/planning_stats` with the same filters (add `"group_by": "decision"` for a breakdown) instead of
   counting rows by hand.
4. **Monuments.** Call `heritage/heritage_monuments_near` with `{ "lat", "lon", "radius_m": 1000 }`. Report
   SMR number, class, townland and distance. Recorded monuments have legal protection; say so.
5. **Protected sites.** Call `environment-sites/protected_sites_near` with `{ "lat", "lon", "radius_m": 2000 }`
   (and `environment-sites/protected_sites_at` for whether the point is inside one).
6. **Groundwater (optional).** `gsi/groundwater_vulnerability_at` with the point; a 1:40,000 screening
   map, not a site investigation.
7. **Context (optional).** `wikidata/wikidata_place` for a short description of the townland or village.

## Output format

Illustrative layout; the values are examples, not data.

```
## Within 500 m of <place> (<lat>, <lon>), Galway City Council
**Planning (since 2025-01-01):** 7 applications
| Ref | Received | Decision | Description (short) |
**Recorded monuments (1 km):** GA094-091---- Religious house – Dominican friars, 120 m
**Protected sites (2 km):** Inner Galway Bay SPA (004031)
Sources
- National Planning Application Database, Department of Housing (CC BY 4.0), retrieved <date>
- National Monuments Service SMR (CC BY 4.0); NPWS designated areas (CC BY 4.0)
```

## Rules

- Follow [../_shared/citations.md](../_shared/citations.md).
- NPAD may lag council systems; the council's own planning portal is the authority. Say so.
- No opinion on whether an application will or should be granted, and no legal advice on
  objections, monuments or habitats. Point to the planning authority, NMS or NPWS.
- Give distances as returned; do not estimate them.
