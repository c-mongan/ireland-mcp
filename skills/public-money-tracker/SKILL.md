---
name: public-money-tracker
description: Follows public money around one Irish place, body or topic by combining adopted council budgets, EU tenders from Irish public buyers on TED, EU cohesion-funded projects on Kohesio, and related lobbying returns, via the Ireland MCP server, with each figure labelled as a budget, a tender estimate or an EU grant. Use when someone asks where public money goes in their county, what a council or agency is procuring, which EU-funded projects exist nearby, or wants a joined-up picture of spending on a topic such as housing or water.
license: MIT
---

# Public money tracker

Join four kinds of public-money record for one place, buyer or topic, and keep them clearly apart.
Use council-budget-compare for a pure budget comparison and eu-funding-finder for EU grants only.

**Related projects:** [PublicPurse.ie](https://publicpurse.ie) (William Kennedy),
[StateSpend.ie](https://statespend.ie) (Albert Dolan TD, Matthew Fenlon),
[Where Your Money Goes](https://whereyourmoneygoes.gov.ie) (Government),
[Local Authority Finances](https://localauthorityfinances.com) (Gerard Turley, Stephen McNena).
Not affiliated; see [../_shared/inspirations.md](../_shared/inspirations.md).

## Calling the tools

Steps name each operation as source/operation (e.g. `ted/ted_search_tenders`), using the typed tool name
as the operation. On the default surface, run it with `ireland_call`, for example:

```json
{ "source": "ted", "operation": "ted_search_tenders", "args": { "buyer": "Galway City Council", "limit": 20 } }
```

If an argument shape is unclear, call `ireland_describe` with `{ "source", "operation" }` first;
it returns the schema and an example. `search`, `fetch` and `nearby` are top-level tools. If the
server was added with `?toolsets=<ids>` or `?toolsets=all`, the typed tool can be called directly
with the same `args`.

## Steps

1. **Scope.** Settle one place (council), one buyer (agency) or one topic, and a period.
2. **Council budget.** For a council, call `council-budgets/council_budgets_get` with `{ "year", "authority" }`
   (see council-budget-compare for paging and totals). Report expenditure per division.
3. **Tenders.** Call `ted/ted_search_tenders` with `buyer` and/or `text`, plus `since`/`until`
   (YYYY-MM-DD). Page with `cursor`. Report title, buyer, estimated `value` and the notice link. Open
   one notice with `ted/ted_get_notice` when detail is needed. TED covers above-EU-threshold notices only.
4. **EU-funded projects.** Call `kohesio/kohesio_search_projects` with `query` (a place or topic) or
   `region` (NUTS name or code such as "IE042"). Report title, beneficiary, fund, EU budget and dates,
   and the snapshot date the tool returns.
5. **Lobbying on the topic (optional).** `lobbying/lobbying_search_returns` with the topic words and the
   same period, to show who sought to influence policy in the area (see lobbying-watch).
6. **Assemble.** Keep each record type in its own section with its own totals. Never add budgets,
   tender estimates and EU grants together; they measure different things and can overlap.

## Output format

Illustrative layout; the values are examples, not data.

```
## Public money: Galway City, 2026
### Adopted council budget (estimate, not spend)
| Division | Expenditure | Source |
### Tenders published on TED (estimated values)
| Date | Title | Estimated value | Notice |
### EU cohesion-funded projects (Kohesio snapshot DATE)
| Project | Beneficiary | Fund | EU budget | Period |
Sources
- ...
```

## Rules

- Follow [../_shared/citations.md](../_shared/citations.md); add TED (Publications Office of the EU,
  CC BY 4.0) and council budgets (Department of Housing, CC BY-SA 4.0).
- Label every amount: budget estimate, tender estimated value, or EU grant. None is actual spend.
- No central Government line-item spending is available here; say so if asked, and point to
  gov.ie Revised Estimates.
- No suggestion of waste, fraud or favouritism. Describe records only.
