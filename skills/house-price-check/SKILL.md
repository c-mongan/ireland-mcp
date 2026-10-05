---
name: house-price-check
description: Checks recorded Irish residential sale prices from the Property Price Register (PSRA) through the Ireland MCP server, giving median, quartiles and example sales for a county, town, street, Eircode routing key or date range, with the register's caveats. Use when someone asks what houses sold for in an Irish area, wants a price trend or comparison between areas or years, or wants recent sales near an address. Not a valuation.
license: MIT
---

# House price check

Summarise what homes actually sold for, using the Residential Property Price Register.

## Calling the tools

Steps name each operation as source/operation (e.g. `ppr/ppr_price_stats`), using the typed tool name as the operation. On the
default surface, run it with `ireland_call`, for example:

```json
{ "source": "ppr", "operation": "ppr_price_stats", "args": { "county": "Galway", "address": "oranmore" } }
```

If an argument shape is unclear, call `ireland_describe` with `{ "source", "operation" }` first;
it returns the schema and an example. `search`, `fetch` and `nearby` are top-level tools. If the
server was added with `?toolsets=<ids>` or `?toolsets=all`, the typed tool (e.g. `ppr_price_stats`) can
be called directly with the same `args`.


## Steps

1. **Pin the area.** Need a `county` (e.g. "Galway", "Dublin"). Narrow with `address` words
   ("oranmore", "dublin 8") or an `eircode` routing key ("H91", "D08"). If the user gives only a
   town, find its county first (e.g. `cross/ireland_snapshot` with `{ "place": "Athlone" }`).
2. **Pick the window.** Default to the last 12 months (`from`/`to` as YYYY-MM-DD). Keep each query
   within 3 calendar years; for longer trends run one query per year.
3. **Get the stats.** Call `ppr/ppr_price_stats`, for example
   `{ "county": "Galway", "address": "oranmore", "from": "2025-10-01", "to": "2026-09-30" }`.
   Use `property`: `new` or `second-hand` to split them; default is `any`.
4. **Show examples.** Call `ppr/ppr_search_sales` with the same filters, `"sort": "date_desc"`,
   `"limit": 10`. Use `price_desc`/`price_asc` for the extremes.
5. **Compare** (optional): repeat step 3 per area or per year and put them side by side.
6. Leave `include_non_market` false unless the user asks; say non-market sales were excluded.
7. Date the answer with the tool's `last_sale` (stats) or newest sale `date`: "PPR data as of <date>".
   Sales flagged `vat_exclusive: true` are new homes whose price excludes VAT.

## Output format

Illustrative layout; the values are examples, not data.

```
### Sale prices: Oranmore, Co. Galway (1 Oct 2025 – 30 Sep 2026)
| Measure | Value |
|---|---|
| Sales recorded | 142 |
| Median | €410,000 |
| Lower–upper quartile | €330,000 – €505,000 |
| New / second-hand | 31 / 111 |

Recent sales
| Date | Address | Price | Type |
|---|---|---|---|

Caveats: no size or bedroom data; new-home prices exclude VAT; non-market sales excluded.
PPR data as of <date>.
Sources
- Residential Property Price Register, PSRA (PSI General Licence / CC BY 4.0), data as of <date>
```

## Rules

- Follow [../_shared/citations.md](../_shared/citations.md). Every figure has its date range and source.
- **Always state the caveats:** the register has **no floor area or bedroom data**, so prices are
  not like-for-like; **new-home prices exclude VAT** (add 13.5% only if the user asks, and say so);
  entries are self-declared and can be late.
- Quote the sale count next to any median. With fewer than 10 sales, say the sample is too small.
- **Not a valuation, and no financial advice.** Do not say whether a price is fair or whether to
  buy, sell or bid. Point to a registered valuer or estate agent for valuations.
- Addresses are public register entries; do not speculate about buyers or sellers.
