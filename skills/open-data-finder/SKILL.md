---
name: open-data-finder
description: Finds Irish open datasets on data.gov.ie and Smart Dublin (data.smartdublin.ie) through the Ireland MCP server, shows their publisher, licence and resources, and previews rows from CKAN datastore tables. Use when someone asks whether there is open data about a topic in Ireland, needs a dataset link and licence, or wants a quick look at the rows in a public dataset.
license: MIT
---

# Open data finder

Locate the right public dataset and preview it with its licence.

## Calling the tools

Steps name each operation as source/operation (e.g. `ppr/ppr_price_stats`), using the typed tool name as the operation. On the
default surface, run it with `ireland_call`, for example:

```json
{ "source": "data-gov-ie", "operation": "datagov_search_datasets", "args": { "query": "bike counts" } }
```

If an argument shape is unclear, call `ireland_describe` with `{ "source", "operation" }` first;
it returns the schema and an example. `search`, `fetch` and `nearby` are top-level tools. If the
server was added with `?toolsets=<ids>` or `?toolsets=all`, the typed tool (e.g. `datagov_search_datasets`) can
be called directly with the same `args`.


## Steps

1. **Search broadly.** Call `ireland_search` with the topic to see hits across all sources, then
   use `ireland_fetch` on a promising id. With typed tools, `search` and `fetch` do the same.
2. **Search the portals.** Call `data-gov-ie/datagov_search_datasets` (national) and, for Dublin topics,
   `smart-dublin/smartdublin_search_datasets` with the topic words.
3. **Inspect.** Call `data-gov-ie/datagov_get_dataset` (or `smart-dublin/smartdublin_get_dataset`) for the
   chosen dataset: publisher, licence, last modified date and resources (CSV, API, etc.).
4. **Preview rows.** If a resource is in the datastore, call `data-gov-ie/datagov_query_datastore`
   (or `smart-dublin/smartdublin_query_datastore`) with the resource id and a small limit.
5. If a dedicated source covers the topic (CSO, PPR, Met Éireann, OPW, etc.), suggest that source's
   ops instead, because they are cleaner than raw portal files. `cross/list_sources` lists them.

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
