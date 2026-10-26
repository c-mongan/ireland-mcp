---
name: local-election-brief
description: Prepares a neutral, cited brief for a Dáil constituency or an address before an election or a meeting with local representatives, combining GeoHive boundaries (constituency, local electoral area), the sitting TDs from the Oireachtas, each TD's recent parliamentary questions, local census population and change, deprivation and recent house prices, via the Ireland MCP server. Use when someone asks "who are my TDs", "what is happening in my constituency", or wants a local briefing pack before voting or canvassing.
license: MIT
---

# Local election brief

A one-page, even-handed picture of a constituency: who represents it, what they have raised in the
Dáil, and what the local data shows. Use td-briefing for a deep dive on one member.

**Related projects:** [Contact Your Local TD](https://www.contactyourtd.ie/) (Unknown),
[Constituent](https://constituent.ie/) (Owen Connor), [Oireachtas Connect](https://oireachtasconnect.ie/)
(Oireachtas Connect). Not affiliated; see [../_shared/inspirations.md](../_shared/inspirations.md).

## Calling the tools

Steps name each operation as source/operation (e.g. `oireachtas/oireachtas_search_members`), using the
typed tool name as the operation. On the default surface, run it with `ireland_call`, for example:

```json
{ "source": "oireachtas", "operation": "oireachtas_search_members", "args": { "constituency": "Galway West" } }
```

If an argument shape is unclear, call `ireland_describe` with `{ "source", "operation" }` first;
it returns the schema and an example. `search`, `fetch` and `nearby` are top-level tools. If the
server was added with `?toolsets=<ids>` or `?toolsets=all`, the typed tool can be called directly
with the same `args`.

## Steps

1. **Find the constituency.** Call `ireland_resolve_place` with the town, LEA, council or `lat`/`lon`.
   Keep `codes.constituency` (with `seats`), `codes.lea` and `codes.county`. An LEA or council can
   overlap several constituencies; each comes with its share of residents, so name them all.
   From a constituency name, pass `"list": "lea"` to get its LEAs, then go to step 2.
2. **Sitting TDs.** Call `oireachtas/oireachtas_search_members` with `{ "constituency": "<name>" }`.
   List every member returned, in the API's order or alphabetically; never by party preference.
3. **What each TD raised.** For each `member_code`, call `oireachtas/oireachtas_search_questions` with
   `{ "member_code", "date_from": "<3 months ago>", "limit": 50 }`. Count questions and group them by the
   minister or department addressed. Apply the same window and limit to every member.
4. **Local context.** `cso/cso_area_profile` for the county (2016 vs 2022 population);
   `ppr/ppr_price_stats` for the county or a main town over the last 12 months;
   optionally `pobal/pobal_deprivation_search` for named electoral divisions.
5. **Recent Dáil votes (optional).** `oireachtas/oireachtas_get_votes` with `{ "chamber": "dail", "date_from" }`
   gives division tallies, not individual votes; do not attribute a vote to a TD from tallies.

## Output format

Illustrative layout; the values are examples, not data.

```
## <Constituency> (<seats> seats) — brief as of <date>
**Sitting TDs:** <Name> (<Party>), ... (34th Dáil, Oireachtas Open Data)
| TD | Questions (<window>) | Most-addressed departments |
|---|---|---|
**Local data:** population <n> (Census 2022, change since 2016 <x%>); median sale <€> (PPR, <period>)
Sources
- ...
```

## Rules

- Follow [../_shared/citations.md](../_shared/citations.md).
- Strict neutrality: same queries, windows and table columns for every member; no adjectives,
  ratings, predictions or claims about motives or effectiveness.
- Question counts measure activity in one channel only; say so. Ministers do not ask questions.
- Do not include personal contact details beyond the official Oireachtas record links.
- Constituency boundaries changed in 2023; data from before the 34th Dáil may use old boundaries.
