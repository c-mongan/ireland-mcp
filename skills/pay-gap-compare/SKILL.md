---
name: pay-gap-compare
description: Compares employer gender pay gap reports filed under the Gender Pay Gap Information Act 2021 (mean and median hourly gaps, bonus gaps, quartile shares) across companies, years or a NACE industry using the PayGap.ie dataset, and adds CSO national earnings by sex for context, via the Ireland MCP server. Use when someone asks what a company's gender pay gap is, how banks or tech firms compare, how an employer's gap changed between years, or how employer reports relate to national figures.
license: MIT
---

# Pay gap compare

Put employer-reported gender pay gap figures side by side and keep them distinct from national
statistics.

**Related projects:** [PayGap.ie](https://paygap.ie/) (Jennifer Keane). Not affiliated; see
[../_shared/inspirations.md](../_shared/inspirations.md).

## Calling the tools

Steps name each operation as source/operation (e.g. `paygap/paygap_search_reports`), using the typed tool
name as the operation. On the default surface, run it with `ireland_call`, for example:

```json
{ "source": "paygap", "operation": "paygap_search_reports", "args": { "industry": "Financial", "year": 2024, "limit": 50 } }
```

If an argument shape is unclear, call `ireland_describe` with `{ "source", "operation" }` first;
it returns the schema and an example. `search`, `fetch` and `nearby` are top-level tools. If the
server was added with `?toolsets=<ids>` or `?toolsets=all`, the typed tool can be called directly
with the same `args`.

## Steps

1. **Find reports.** Call `paygap/paygap_search_reports` with `company` (name fragment), `year` and/or
   `industry` (words such as "Financial" match the `nace_section` label). NACE letters follow the
   dataset's own coding (finance is "L" in its labels), so check `nace_section` before relying on a letter.
   Page with `offset`.
2. **Check identity.** Several employers can share a name fragment, and one employer can file more
   than one report a year. Show the full name and keep duplicates separate.
3. **Compare.** Tabulate mean and median hourly gap, bonus gaps and the share of women in each pay
   quartile where present. Blank metrics stay "not reported"; zero and negative values are real.
4. **Trend (optional).** Repeat for each available year (`dataset.available_years`) for the same employer.
5. **Industry spread (optional).** For an industry, report the count, median and range of the
   median hourly gap across returned reports; do not average means.
6. **National context (optional).** `cso/cso_search_tables` with "earnings sex" (e.g. SES16 or EHA tables)
   and `cso/cso_get_data` for national figures. Cite separately; they use different methods.
7. **Fallback notice.** If the response shows `fallback: true`, state that the publisher's dated GitHub
   snapshot was used and annotation flags are unavailable.

## Output format

Illustrative layout; the values are examples, not data.

```
## Gender pay gap: financial and insurance activities, 2024 reports
| Employer | Mean hourly gap | Median hourly gap | Mean bonus gap | Women in top quartile | Report |
|---|---|---|---|---|---|
Reports found: 90. Industry median of median hourly gaps: x% (range a%–b%).
Sources
- Irish Gender Pay Gap Portal (PayGap.ie), dataset CC0 1.0; original employer reports linked per row
```

## Rules

- Follow [../_shared/citations.md](../_shared/citations.md); credit PayGap.ie and link each employer report.
- A gender pay gap is not a measure of unequal pay for equal work. Say so once.
- Employer reports are self-reported and not a representative sample of all workers.
- No rankings of "best" or "worst" employers and no claims about employer conduct.
