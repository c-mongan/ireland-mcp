---
name: rights-check
description: Finds and quotes the Irish law behind an everyday rights question (tenancies, employment, consumer, data protection, social welfare) from the Irish Statute Book, shows bills before the Oireachtas that would change it, and points to Citizens Information for plain-English guidance, via the Ireland MCP server. Not legal advice. Use when someone asks "what does the law say about", which Act covers a right, whether a law is being changed, or wants the official text behind a rule.
license: MIT
---

# Rights check

Locate the relevant Act and section, quote it as enacted, show pending changes, and send the user to
the official plain-English guidance. This is information, not legal advice. Use legislation-lookup
when the user already knows the Act and section.

**Related projects:** [Rule.ie](https://rule.ie/) (Unknown). Not affiliated; see
[../_shared/inspirations.md](../_shared/inspirations.md).

## Calling the tools

Steps name each operation as source/operation (e.g. `legislation/legislation_list_acts`), using the typed
tool name as the operation. On the default surface, run it with `ireland_call`, for example:

```json
{ "source": "legislation", "operation": "legislation_list_acts", "args": { "year": 2004, "query": "residential tenancies" } }
```

If an argument shape is unclear, call `ireland_describe` with `{ "source", "operation" }` first;
it returns the schema and an example. `search`, `fetch` and `nearby` are top-level tools. If the
server was added with `?toolsets=<ids>` or `?toolsets=all`, the typed tool can be called directly
with the same `args`.

## Steps

1. **Restate the question** as a topic and, if known, the likely Act (e.g. tenancy notice periods →
   Residential Tenancies Act 2004).
2. **Find the Act.** When the year is known, call `legislation/legislation_list_acts` with
   `{ "year", "query": "<title words>" }`. Top-level `search` only scans Acts from the last three years
   unless the query includes a year (e.g. "residential tenancies 2004"), so add the year or use
   `legislation/legislation_list_acts`.
3. **Find the section.** Call `legislation/legislation_get_act` with `{ "year", "number" }` for the table of
   sections; pick the relevant section headings. Some older Acts return an empty `sections` list; then
   open the eISB link from the response to find the section number, or try likely sections directly.
4. **Quote it.** Call `legislation/legislation_get_section` with `{ "year", "number", "section" }`. Quote
   the operative words briefly with the eISB link. This is the text **as enacted**; later Acts may
   have amended it. Say so, and point to the Law Reform Commission's Revised Acts for current text.
5. **Pending changes.** Call `oireachtas/oireachtas_search_bills` with title words and `status: "Current"`
   to list bills that would change the area, with stage and date.
6. **Plain-English guidance.** Link the relevant citizensinformation.ie topic page by its title. If the
   connected server lists a Citizens Information or legal-evidence source in `ireland_catalogue`
   (an opt-in beta, not on the default hosted server), you may use it and cite it; otherwise do not
   claim to have read Citizens Information.
7. **Who to contact.** Name the body that decides such matters (e.g. RTB, WRC, CCPC, Data Protection
   Commission, Department of Social Protection) without predicting an outcome.

## Output format

Illustrative layout; the values are examples, not data.

```
## What the law says: notice periods for ending a tenancy (information, not legal advice)
**Act:** Residential Tenancies Act 2004 (No. 27 of 2004), as enacted — <eISB link>
**Section <n>:** "<short quote>"
**Amended since?** Likely; check the Revised Act at revisedacts.lawreform.ie.
**Bills that would change this:** 2025/83 ... — Second Stage, Dáil, 2026-01-10
**Plain-English guide:** Citizens Information, "Ending a tenancy" (citizensinformation.ie)
**Who decides disputes:** Residential Tenancies Board
Sources
- Irish Statute Book © Office of the Attorney General (PSI / CC BY 4.0); Oireachtas Open Data (PSI)
```

## Rules

- Follow [../_shared/citations.md](../_shared/citations.md).
- Begin and end with "not legal advice". Recommend a solicitor, FLAC or the relevant body for a
  real decision.
- Quote, do not paraphrase into new legal rules. Never say a right applies to the user's facts.
- Text is as enacted; always flag that amendments may apply.
