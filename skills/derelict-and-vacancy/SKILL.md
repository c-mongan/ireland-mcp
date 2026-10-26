---
name: derelict-and-vacancy
description: Gives cited context on derelict and vacant property in an Irish local authority - which councils publish their Derelict Sites Register on data.gov.ie (and in what format), any rows readable through the open-data datastore, and CSO vacancy counts and long-term vacancy by local authority, LEA or electoral division - via the Ireland MCP server. Use when someone asks about derelict sites in their county, how many homes are vacant locally, or where to find a council's derelict sites register.
license: MIT
---

# Derelict and vacancy

Combine official vacancy statistics with each council's published Derelict Sites Register. Councils
must keep a register under the Derelict Sites Act 1990, but only some publish it as open data.

**Related projects:** [Derelict Ireland](https://acoci86.github.io/derelict-ireland/) (Alessio Coci),
[Derelict Sites](https://www.derelictsites.com/) (Rob Cross). Not affiliated; see
[../_shared/inspirations.md](../_shared/inspirations.md).

## Calling the tools

Steps name each operation as source/operation (e.g. `data-gov-ie/datagov_search_datasets`), using the
typed tool name as the operation. On the default surface, run it with `ireland_call`, for example:

```json
{ "source": "data-gov-ie", "operation": "datagov_search_datasets", "args": { "query": "derelict sites register" } }
```

If an argument shape is unclear, call `ireland_describe` with `{ "source", "operation" }` first;
it returns the schema and an example. `search`, `fetch` and `nearby` are top-level tools. If the
server was added with `?toolsets=<ids>` or `?toolsets=all`, the typed tool can be called directly
with the same `args`.

## Steps

1. **Vacancy numbers.** Call `cso/cso_get_table_metadata` on VAC14 (local authority), VAC15 (LEA) or
   VAC16 (electoral division), then `cso/cso_get_data` for the area and the latest Q4: vacant
   dwellings, dwelling stock and vacancy rate. For six-year long-term vacancy, use VAC23 (local
   authority) or VAC24 (LEA).
2. **Find the register.** Call `data-gov-ie/datagov_search_datasets` with
   `{ "query": "derelict sites register <council>" }`. Pick the dataset whose publisher is the council.
   If none, say the council does not publish it on data.gov.ie and point to the council website.
3. **Inspect it.** Call `data-gov-ie/datagov_get_dataset` with the dataset `id`. Report publisher,
   licence, last modified date, formats and resource links.
4. **Read rows if possible.** If a resource has `datastore: true`, call
   `data-gov-ie/datagov_query_datastore` with `{ "resource_id", "limit": 100 }` (add `q` for a town).
   Count entries and summarise by area. If no resource is in the datastore, give the download link
   and do not guess the contents.
5. **Dublin extras (optional).** `smart-dublin/smartdublin_search_datasets` with "derelict" or "vacant".
6. **Coverage note.** List which councils you found registers for, so the user sees the gaps.

## Output format

Illustrative layout; the values are examples, not data.

```
## Vacancy and dereliction: South Dublin County Council
**Vacancy (CSO VAC14, 2024Q4):** 1,234 vacant of 105,678 dwellings (1.2%)
**Derelict Sites Register:** published by SDCC on data.gov.ie (CSV, KML; updated 2026-09-22) — <link>
Entries readable here: 41 (datastore) | not in datastore: download link only
Sources
- CSO VAC14 (CC BY 4.0); Derelict Sites Register, South Dublin County Council (CC BY 4.0) via data.gov.ie
```

## Rules

- Follow [../_shared/citations.md](../_shared/citations.md); name each council as the publisher.
- CSO vacancy uses low electricity consumption; it is not the same as dereliction. Say so.
- Do not publish or infer owners' names or personal details, even if a register contains them.
  Report site locations at the level the register gives and link to it.
- A site on a register is a legal designation by the council, not a finding by this skill.
