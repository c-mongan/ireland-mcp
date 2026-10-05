---
name: open-data-finder
description: Finds Irish open datasets on data.gov.ie and Smart Dublin (data.smartdublin.ie) through the Ireland MCP server, shows their publisher, licence and resources, and previews rows from CKAN datastore tables. Use when someone asks whether there is open data about a topic in Ireland, needs a dataset link and licence, or wants a quick look at the rows in a public dataset.
license: MIT
---

# Open data finder

Locate the right public dataset and preview it with its licence.

## Calling the tools

Each step names a **source** and an **op** as `source.op`. With the default lean surface, call
`ireland_call` with `source`, `op` and `args`, and run `ireland_describe(source, op)` first if you
are unsure of the arguments. If typed toolsets are enabled (`?toolsets=...`, or a server that
lists typed tools), call the op name directly as a tool with the same arguments.


## Steps

1. **Search broadly.** Call `ireland_search` with the topic to see hits across all sources, then
   use `ireland_fetch` on a promising id. With typed tools, `cross.search` and `cross.fetch` do the same.
2. **Search the portals.** Call `data-gov-ie.datagov_search_datasets` (national) and, for Dublin topics,
   `smart-dublin.smartdublin_search_datasets` with the topic words.
3. **Inspect.** Call `data-gov-ie.datagov_get_dataset` (or `smart-dublin.smartdublin_get_dataset`) for the
   chosen dataset: publisher, licence, last modified date and resources (CSV, API, etc.).
4. **Preview rows.** If a resource is in the datastore, call `data-gov-ie.datagov_query_datastore`
   (or `smart-dublin.smartdublin_query_datastore`) with the resource id and a small limit.
5. If a dedicated source covers the topic (CSO, PPR, Met Éireann, OPW, etc.), suggest that source's
   ops instead, because they are cleaner than raw portal files. `cross.list_sources` lists them.

## Output format

```
| Dataset | Publisher | Licence | Updated | Formats | Link |
|---|---|---|---|---|---|
Preview (<resource>, first 5 rows): <table>
Sources
- data.gov.ie catalogue; data © <publisher> (<licence>)
```

## Rules

- Follow [../_shared/citations.md](../_shared/citations.md). Licences are per dataset: report each one.
- Show the dataset's last-modified date; flag datasets not updated in over 2 years as possibly stale.
- Do not claim a dataset is complete or authoritative beyond what its publisher states.
