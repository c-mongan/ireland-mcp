---
name: safety-stats
description: Reports official road-safety and recorded-crime statistics for Ireland by county, Garda division or Garda station and year or quarter - persons killed and injured on roads (RSA tables published via the CSO) and recorded crime incidents by offence type (CSO) - with population rates from the census, via the Ireland MCP server. Use when someone asks how many people died on roads in a county, how recorded crime changed in a Garda division, or wants road deaths or crime compared between areas or years.
license: MIT
---

# Safety stats

Cited counts and rates for road casualties and recorded crime. These are official statistics, not
a measure of how safe a particular street or person is.

**Related projects:** [Ireland Road Deaths](https://www.rsa.ie/road-safety/statistics/collisions) (RSA),
[Crime Stats IE](https://www.crimestats.ie/) (Brian Fox). Not affiliated; see
[../_shared/inspirations.md](../_shared/inspirations.md).

## Calling the tools

Steps name each operation as source/operation (e.g. `cso/cso_get_data`), using the typed tool name as
the operation. On the default surface, run it with `ireland_call`, for example:

```json
{ "source": "cso", "operation": "cso_get_data", "args": { "table_code": "ROA15", "filters": { "TLIST(A1)": ["2023", "2024"] } } }
```

If an argument shape is unclear, call `ireland_describe` with `{ "source", "operation" }` first;
it returns the schema and an example. `search`, `fetch` and `nearby` are top-level tools. If the
server was added with `?toolsets=<ids>` or `?toolsets=all`, the typed tool can be called directly
with the same `args`.

## Tables

| Topic | Table | Geography | Time |
|---|---|---|---|
| Persons killed and injured | ROA15 | County | Year |
| Collisions and casualties | ROA27 | County | Year |
| Casualties by road user, age, sex | ROA16 | State | Year |
| Recorded crime by offence | CJQ06 | Garda division (old model; archived June 2026) | Quarter |
| Recorded crime by offence | CJQ10 | Garda division (new operating model) | Quarter |
| Recorded crime by offence | CJA07 / CJA11 | Garda station (old / new model) | Year |

Confirm a table is current with `cso/cso_search_tables` ("road deaths", "recorded crime") if a call fails.

## Steps

1. **Get codes.** Call `cso/cso_get_table_metadata` with `{ "table_code": "ROA15" }` (or the crime table).
   Note the dimension codes (e.g. "C03867V04617" County, "C02481V03160" Garda Division) and the
   category code for each place, offence and period.
2. **Fetch.** Call `cso/cso_get_data` with filters for every dimension you need, e.g. ROA15
   `{ "TLIST(A1)": ["2023","2024"], "C03867V04617": ["<county code>"] }`. Keep results under 500 rows.
   For crime, filter `TLIST(Q1)` (codes like "20251") and the Garda Division; pick headline offence
   groups (two-digit category codes such as "01"; their labels end in "(01)") rather than every
   sub-offence. Prefer CJQ10 for recent quarters.
3. **Rates (optional).** Divide by population from `cso/cso_area_profile` (county) and show per
   100,000 with the census year. Garda divisions do not match counties exactly; say so.
4. **Compare periods.** Use full years or the same quarters year on year; quarterly crime is seasonal.
5. **Null values** mean not yet published; never treat them as zero.

## Output format

Illustrative layout; the values are examples, not data.

```
## Road casualties, Co. Galway
| Year | Killed | Injured | Killed per 100k (Census 2022) |
|---|---|---|---|
| 2023 | 12 | 391 | 4.4 |
| 2024 | 5 | not yet published | 1.8 |
Sources
- Road Safety Authority, table ROA15 via CSO PxStat (CC BY 4.0), retrieved <date>
```

## Rules

- Follow [../_shared/citations.md](../_shared/citations.md).
- Recorded-crime figures can be revised, and fraud (offence group 09) figures before and after
  2023Q3 are not comparable; say so when either applies.
- Recorded crime reflects reporting and recording, not all crime. Small counts swing year to year.
- No safety advice, no area labels like "dangerous", and no claims about causes.
