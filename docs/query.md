# Server-side queries: table handles and `ireland_query`

Many questions need more rows than an agent can read. "How many planning applications did Galway City
Council receive in 2024?" needs 325 rows. "Rank Galway's local electoral areas by new homes per 1,000
residents, with their deprivation" needs 212 electoral divisions, 3,417 deprivation scores and a CSO
table. Pulling those into the conversation is slow and costly. The agent then has to add up long columns
by hand, which is where mistakes creep in.

`ireland_query` does that work on the server. The agent names the tables, then says how to filter, join,
group, count and rank them. The server loads every row, computes the answer and returns only the answer
rows, with the evidence for each input.

```text
ireland_call ──► result + table_id ──┐
                                     ├──► ireland_query ──► answer rows
{source, operation, args} ───────────┘    (filter, join,     + each input's source, licence,
                                           aggregate, rank)    attribution, URL, retrieval time
                                                              + the query, echoed
```

## Table handles

A table-capable operation adds a `table_id` to its `ireland_call` result. Its dataset card shows
`table_handle: true` in `ireland_describe`. A `table_id` is a plain description of the call that made the
table:

```text
planning/planning_search?{"council":"Galway City Council","from":"2024-01-01","to":"2024-12-31"}
```

The server stores no copy of your data. When `ireland_query` receives a handle, it runs the same call
again and reads every page. Upstream pages are cached, so this is usually quick. The handle does not
expire. A later query can return newer data, and each input says when its data was retrieved.

You can skip the handle. Give `{ "source", "operation", "args" }` instead. Paging arguments (`limit`,
`offset`, `page`) are ignored, because the server reads the whole table.

| Operation | Table rows | How it loads |
| --- | --- | --- |
| `cso/cso_get_data` | one row per cell (dimension labels, `value`, `unit`) | one JSON-stat read, up to 10,000 cells |
| `planning/planning_search` | one row per application | exact count first, then pages of 2,000, checked against the count |
| `planning/planning_stats` | one row per group | ArcGIS computes the counts and sums |
| `pobal/pobal_deprivation_search` | one row per electoral division; omit `query` for all 3,417 | pages of 500 |
| `cross/ireland_resolve_place` with `list` | one row per area inside the place | one read of the crosswalk |
| `ppr/ppr_search_sales` | one row per sale | pages of 500 |
| `paygap/paygap_search_reports` | one row per employer report | pages of 500 |
| `kohesio/kohesio_search_projects` | one row per project | pages of 500 |
| `council-budgets/council_budgets_get` | one row per budget line | pages of 500 |

A table must load in full or not at all. If a source cannot be read to the end, or holds more than 10,000
rows, the query fails and says why. It never computes over part of a table. Narrow the source
arguments first, for example by council, dates or table codes.

## Steps

With no `steps`, `ireland_query` describes each table: its column names and types, its row count and five
preview rows. Use this to see the column names before you write the steps.

Steps run in order, starting from the `from` table (the first table by default). Each table can also
have its own `steps`, which run before the main steps. Table steps cannot join or union.

| Step | Example | What it does |
| --- | --- | --- |
| `filter` | `["residential_units", ">", 0]` | Keeps matching rows. Ops: `=`, `!=`, `>`, `>=`, `<`, `<=`, `in`, `not_in`, `contains`, `starts_with`, `is_null`, `not_null`. Combine with `{"and": [...]}`, `{"or": [...]}` and `{"not": ...}`. |
| `join` | `{"join": "dep", "on": ["code", "ed_id"]}` | Adds the matching rows of another table. `on` is one shared column name, a `[left, right]` pair or a list of pairs. `type` is `inner` (default) or `left`. `normalize: true` ignores case, accents, punctuation and a leading "Co.". `where` filters the other table first. |
| `union` | `{"union": "b"}` | Appends another table's rows. |
| `derive` | `{"per_1000": "round(value / population * 1000, 2)"}` | Adds computed columns. |
| `aggregate` | `{"aggregate": {"n": "count", "units": "sum:residential_units"}, "group_by": ["council"]}` | One row per group, or one row for the whole table without `group_by`. |
| `select` | `["lea", "per_1000"]` or `{"new": "old"}` | Keeps and renames columns. |
| `sort` | `"-per_1000"` or `["county", "-n"]` | A `-` prefix sorts descending. Empty values sort last. |
| `limit` | `10` | Keeps the first rows. |
| `rank` | `{"by": "per_1000"}` | Adds a `rank` column: 1 is the highest, ties share a rank. Set `"desc": false` to rank the lowest first. `partition_by` ranks within groups. |
| `pct_of_total` | `{"col": "n", "partition_by": ["county"]}` | Adds each row's share of the total, in per cent. |
| `distinct` | `["county"]` | Unique values of the columns. |

**Aggregates** are written `"fn"` or `"fn:column"`: `count`, `count_distinct`, `sum`, `avg`, `min`,
`max`, `median`, `first`, and `weighted_avg:column:weight` (for example a population-weighted
deprivation score). Sums and averages skip empty and non-numeric cells. The result lists how many
cells were skipped under `warnings`.

**Expressions** in `derive` use `+ - * / %`, comparisons (`> >= < <= = !=`), numbers, `'text'` and
column names. Write a name with spaces in brackets, such as `[Local Electoral Area]`. Functions:
`round(x, dp)`, `abs`, `floor`, `ceil`, `min`, `max`, `coalesce`, `if(cond, a, b)`, `lower`, `upper`,
`trim`, `norm` (the same folding as `normalize`), `concat`, `substr(s, start, len)`,
`split_part(s, sep, n)`, `replace(s, find, with)`, `len`, `number`, `text`, `year`, `month` and
`pct_change(old, new)`. Dividing by zero gives an empty value, not an error.

**Comparisons** are typed. A number column compares as numbers, and the text `"2024"` equals the number
`2024`. Text compares exactly, except `contains` and `starts_with`, which ignore case. Join keys compare
as text, so the ED id `"068001"` keeps its leading zero. Column names match without regard to case. An
unknown column gives an error that lists the real ones.

## Worked example: Galway's local electoral areas

**Question.** Rank Galway County Council's local electoral areas by new homes completed in 2024 per
1,000 residents, and show each area's population-weighted Pobal deprivation score.

This combines three sources:

- **The place crosswalk.** It lists the 212 electoral divisions (EDs) of the council, with each one's LEA
  and Census 2022 population.
- **Pobal.** It gives the 2022 deprivation score of all 3,417 EDs.
- **CSO table NDA05.** It gives the 2024 new dwelling completions for every LEA, labelled
  "LEA, council".

```json
{
  "tables": [
    { "alias": "eds", "source": "cross", "operation": "ireland_resolve_place", "args": { "place": "Galway County Council", "list": "ed" } },
    { "alias": "dep", "source": "pobal", "operation": "pobal_deprivation_search", "args": {}, "steps": [{ "select": ["ed_id", "relative_score_2022"] }] },
    { "alias": "done", "source": "cso", "operation": "cso_get_data", "args": { "table_code": "NDA05", "filters": { "TLIST(A1)": ["2024"] } },
      "steps": [
        { "filter": ["Local Electoral Area", "contains", ", Galway County"] },
        { "derive": { "lea": "trim(split_part([Local Electoral Area], ',', 1))" } },
        { "select": { "lea": "lea", "completions_2024": "value" } }
      ] }
  ],
  "steps": [
    { "join": "dep", "on": ["code", "ed_id"] },
    { "aggregate": { "population": "sum:population_2022", "deprivation_score": "weighted_avg:relative_score_2022:population_2022", "eds": "count" }, "group_by": ["lea"] },
    { "join": "done", "on": "lea", "normalize": true },
    { "derive": { "completions_per_1000": "round(completions_2024 / population * 1000, 2)", "deprivation_score": "round(deprivation_score, 1)" } },
    { "rank": { "by": "completions_per_1000" } },
    { "sort": "rank" }
  ]
}
```

The query runs in these steps:

1. Join each ED to its Pobal score by ED id.
2. Roll the EDs up to LEAs. Sum the population, and weight each ED's deprivation score by its
   population.
3. Join the CSO completions by LEA name, ignoring case and punctuation.
4. Divide the completions by the population, then rank the LEAs.

Result, retrieved on 27 October 2026 (`row_count` 7):

| Rank | LEA | Population (2022) | EDs | Completions (2024) | Per 1,000 | Deprivation score |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | Conamara South | 23,345 | 14 | 165 | 7.07 | 1.9 |
| 2 | Gort-Kinvara | 25,923 | 26 | 180 | 6.94 | 6.5 |
| 3 | Ballinasloe | 29,855 | 47 | 198 | 6.63 | -3.9 |
| 4 | Tuam | 35,544 | 35 | 170 | 4.78 | 0.1 |
| 5 | Loughrea | 25,498 | 39 | 93 | 3.65 | 1.1 |
| 6 | Athenry-Oranmore | 35,105 | 23 | 109 | 3.10 | 5.2 |
| 7 | Conamara North | 18,053 | 28 | 47 | 2.60 | -2.8 |

The response held only these 7 rows, not the 3,796 rows it read. It also listed the three inputs: each
`table_id`, row count, source, licence, attribution, URL and retrieval time, and the query itself.

All 212 EDs matched a Pobal score and an LEA. The population totals equal the crosswalk's LEA
populations. Pobal's relative score has a national mean of 0. Positive is more affluent and negative
is more disadvantaged.

## Planning counts at any scale

`planning_search` now returns the exact `total` and a `next_offset`, and pages with `offset`. If the
count request fails, `total` is `null` and `total_note` says the total is unknown.

`planning_stats` asks the planning service itself for counts and sums. It works across the whole country
in one request:

```json
{ "source": "planning", "operation": "planning_stats", "args": { "from": "2024-01-01", "to": "2024-12-31", "group_by": "council" } }
```

`min_units: 1` keeps only applications that propose homes. Not every council records the unit count.
`units_recorded` shows how many applications filled it in. For 2024, Cork County and Dún
Laoghaire-Rathdown left it blank, and Cork City and Fingal entered 0 for every application. A sum of 0
for those councils means the count is unknown, not that no homes were proposed.

## Limits

These limits keep one public query from tying up the server. Each one is tested.

| Limit | Value |
| --- | ---: |
| Tables per query | 4 |
| Rows per table | 10,000 |
| Upstream pages per table | 25 |
| Rows across all tables | 20,000 |
| Rows at any step, checked before a join is built | 50,000 |
| Cells (rows × columns) at any step | 1,000,000 |
| Columns | 64 |
| Steps | 20 main, 30 including the tables' own steps |
| Condition size | 100 parts, 8 levels deep, 500 values in an `in` list |
| Expression size | 500 characters, 200 parts, 24 levels deep; built text up to 1,000 characters |
| Work budget | 5,000,000 units, counted the same way on every run |
| Time | 25 s to load the tables; 3 s to compute |
| Rows returned | 50 by default, 500 at most; `max_tokens` up to 8,000 |
| Queries running at once on one server | 4 |

A result that does not fit `max_tokens` keeps whole rows, sets `truncated: true` and says how many rows
were left out. It never cuts a value in half.

## Safety

`ireland_query` runs calculations that callers write, on a public server. It is built to be safe:

- **No code runs.** Steps are JSON. Expressions are parsed into a fixed set of operators and functions.
  Nothing is passed to `eval`, SQL or a regular-expression engine. `contains`, `split_part` and `replace`
  match plain text.
- **Handles grant nothing new.** A `table_id` only names an operation and its arguments. Each use is
  checked as `ireland_call` would check it: only table-capable operations, only known arguments, the
  same schema. Upstream URLs are still built by each source from fixed hosts.
- **No shared state.** Results are computed for each request and are not written to the cache. Only the
  source's own upstream reads are cached, as with `ireland_call`.
- **Bounded work.** The limits above stop large joins and runaway expressions before they use much
  memory. A join's size is worked out before it is built. Column names such as `__proto__` are
  rejected, and rows are plain records with no prototype.
