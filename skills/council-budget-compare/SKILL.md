---
name: council-budget-compare
description: Compares adopted local-authority budgets across Irish councils and years by service division (Housing, Roads, Water, Development, Environment, Recreation, Agriculture/Education/Health/Welfare, Miscellaneous), with optional per-resident figures from CSO population by local authority area, using the official Department of Housing budget workbooks via the Ireland MCP server. Use when someone asks how much a council plans to spend on housing or roads, how two councils' budgets compare, or how a council's budget changed between years.
license: MIT
---

# Council budget compare

Side-by-side adopted budget estimates for councils, by division A–H, with arithmetic shown. Use
public-money-tracker when the question spans councils, EU funds and tenders together.

**Related projects:** [Local Authority Finances](https://localauthorityfinances.com) (Gerard Turley,
Stephen McNena). Not affiliated; see [../_shared/inspirations.md](../_shared/inspirations.md).

## Calling the tools

Steps name each operation as source/operation (e.g. `council-budgets/council_budgets_get`), using the
typed tool name as the operation. On the default surface, run it with `ireland_call`, for example:

```json
{ "source": "council-budgets", "operation": "council_budgets_get", "args": { "year": 2026, "authority": "Galway City Council", "division": "A" } }
```

If an argument shape is unclear, call `ireland_describe` with `{ "source", "operation" }` first;
it returns the schema and an example. `search`, `fetch` and `nearby` are top-level tools. If the
server was added with `?toolsets=<ids>` or `?toolsets=all`, the typed tool can be called directly
with the same `args`.

## Steps

1. **Check years.** Call `council-budgets/council_budgets_list_years`. Use only years with
   `supported: true`; report `partial` years and the `reason` for unsupported ones.
2. **Fetch each council.** Call `council-budgets/council_budgets_get` with `{ "year", "authority", "division" }`.
   Use the workbook's exact council name (e.g. "Dún Laoghaire-Rathdown County Council",
   "Limerick City and County Council"); a NOT_FOUND error lists the valid names.
   Page with `offset` = `next_offset` until it is null. Omit `division` to get every division.
3. **Total per division.** Sum `amount` for `measure: "Expenditure"` per division. Keep Income separate;
   never add income to expenditure. Show the number of lines summed.
4. **Per resident (optional).** Call `cso/cso_get_table_metadata` with `{ "table_code": "URLIA02" }` to find the
   Local Authority Area code, then `cso/cso_get_data` with filters `"STATISTIC": ["URLIA02C01"]`,
   `"C02199V02655": ["-"]` (both sexes) and the area code. The table has no urban/rural total, so sum
   its six Urban/Rural Location rows. Label it "usually resident and present, Census 2022"; the budget
   year and the census year differ.
5. **Change over time (optional).** Repeat step 2 for an earlier supported year and show the % change
   per division. Do not adjust for inflation unless asked; if asked, use a CSO CPI table from
   `cso/cso_search_tables` and cite it.

## Output format

Illustrative layout; the values are examples, not data.

```
## Adopted budget 2026: Galway City Council vs Limerick City and County Council (EUR)
| Division | Galway City | Limerick | Galway per resident | Limerick per resident |
|---|---|---|---|---|
| A Housing & Building | €… (n lines) | €… | €… | €… |
Population: Census 2022, CSO URLIA02. Budget: adopted estimates, not actual spend.
Sources
- Department of Housing, Local Government and Heritage, Local Authority Annual Budgets (CC BY-SA 4.0), <year> workbook
```

## Rules

- Follow [../_shared/citations.md](../_shared/citations.md); name the workbook year.
- These are adopted budget estimates, not audited outturns or actual expenditure. Say so once.
- Councils differ in size, function and boundaries (city vs county); flag that before comparing.
- No judgements on whether a council spends "too much" or "too little".
