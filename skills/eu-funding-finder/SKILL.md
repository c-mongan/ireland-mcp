---
name: eu-funding-finder
description: Finds EU cohesion-funded projects in Ireland (ERDF, ESF+, Just Transition Fund and others) by place, region or theme from the official Kohesio exports, and adds open EU tenders from Irish public buyers on TED and Eurostat context, via the Ireland MCP server. Use when someone asks which EU-funded projects exist in their county, what the Just Transition Fund paid for in the Midlands, who received EU money for greenways or research, or where to look for EU-funded opportunities.
license: MIT
---

# EU funding finder

List EU-funded projects that match a place or theme, with beneficiary, fund and amounts, and show
related open tenders. This describes past and current awards; it does not assess eligibility for
new grants.

**Related projects:** None in the catalogue cover Kohesio directly; see
[../_shared/inspirations.md](../_shared/inspirations.md) for related public-money projects.

## Calling the tools

Steps name each operation as source/operation (e.g. `kohesio/kohesio_search_projects`), using the typed
tool name as the operation. On the default surface, run it with `ireland_call`, for example:

```json
{ "source": "kohesio", "operation": "kohesio_search_projects", "args": { "query": "greenway", "limit": 20 } }
```

If an argument shape is unclear, call `ireland_describe` with `{ "source", "operation" }` first;
it returns the schema and an example. `search`, `fetch` and `nearby` are top-level tools. If the
server was added with `?toolsets=<ids>` or `?toolsets=all`, the typed tool can be called directly
with the same `args`.

## Steps

1. **Search projects.** Call `kohesio/kohesio_search_projects` with `query` (one plain word works best:
   "greenway", "Galway", "research") and/or `region` (e.g. "Midland", "IE063"). Add `min_eu_budget` to
   focus on large awards. If a multi-word query returns nothing, retry with one word.
2. **Page.** Use `offset` = `next_offset` until null or a stated cap. Report `total`.
3. **Detail.** For a project of interest, call `kohesio/kohesio_get_project` with its Q id.
4. **Summarise.** Group by fund (ERDF, ESF/ESF+, JTF, ...), programming period and beneficiary. Sum
   EU budget within a group only, and say how many projects were summed.
5. **Open tenders (optional).** `ted/ted_search_tenders` with `text` for the theme and `since` = today
   minus 60 days, for current procurement by Irish public buyers.
6. **EU context (optional).** `eurostat/eurostat_search_datasets` and `eurostat/eurostat_compare_ie_eu`
   for an Ireland vs EU indicator on the same theme, cited separately.

## Output format

Illustrative layout; the values are examples, not data.

```
## EU-funded projects matching "greenway" (Kohesio snapshot 2026-09-24)
| Project | Beneficiary | Fund | EU budget | Total budget | Period | Region |
|---|---|---|---|---|---|---|
Totals by fund: JTF €… (n projects); ERDF €… (n)
Open tenders (TED): <date> <title> — <buyer> (<link>)
Sources
- European Commission, Kohesio platform, Ireland exports dated 2026-09-24
```

## Rules

- Follow [../_shared/citations.md](../_shared/citations.md).
- Kohesio here is a dated snapshot, not live; always state the snapshot date. Interreg projects are
  excluded from these exports.
- No advice on applying for or qualifying for funding. Point to the managing authority named in the
  project record, or to the Regional Assemblies and Pobal for current calls.
- EU budget is the EU co-financing amount; total budget includes national funding.
