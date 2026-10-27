---
name: legislation-lookup
description: Looks up Irish Acts, sections, Statutory Instruments, Constitution Articles and Act amendments in the Irish Statute Book (eISB) through the Ireland MCP server and quotes the official text with a citation, links the Act to its Oireachtas bill and stages, and identifies EU acts that an SI transposes. Use when someone asks what an Irish Act, SI or Constitution Article says, whether a section has been amended or commenced, or which Act covers a topic. Gives the text, not legal advice.
license: MIT
---

# Legislation lookup

Find and quote Irish legislation accurately.

**Related projects:** [Rule.ie](https://rule.ie/) (Unknown). Not affiliated; see
[../_shared/inspirations.md](../_shared/inspirations.md).

## Calling the tools

Steps name each operation as source/operation (e.g. `ppr/ppr_price_stats`), using the typed tool name as the operation. On the
default surface, run it with `ireland_call`, for example:

```json
{ "source": "legislation", "operation": "legislation_list_acts", "args": { "year": 2018, "query": "data protection" } }
```

If an argument shape is unclear, call `ireland_describe` with `{ "source", "operation" }` first;
it returns the schema and an example. `search`, `fetch` and `nearby` are top-level tools. If the
server was added with `?toolsets=<ids>` or `?toolsets=all`, the typed tool (e.g. `legislation_list_acts`) can
be called directly with the same `args`.


## Steps

1. **Find the Act.** Call `legislation/legislation_list_acts` with `{ "year": 2004, "query": "residential tenancies", "limit": 10 }`.
   Pick by title and year; if several fit, list them and ask.
2. **Get the Act.** Call `legislation/legislation_get_act` with the Act `year` and `number` from
   step 1, e.g. `{ "year": 2018, "number": 7 }` (Data Protection Act 2018). Show the section list.
3. **Get a section.** Call `legislation/legislation_get_section` with `year`, `number` and
   `section` (a string such as "2" or "19A") and quote it verbatim.
4. **Check amendments and commencement.** Call `legislation/legislation_get_act_effects` with
   `{ "year": 2018, "number": 7, "section": "2" }`. Report when the section commenced and every listed
   amendment, repeal or restriction, with `updated_to`. The quoted text is as enacted; if effects exist,
   say the current wording may differ and name the affecting provisions.
5. **Statutory Instruments.** Call `legislation/legislation_list_sis` with `{ "year": 2024, "query": "sick leave" }`,
   then `legislation/legislation_get_si` with `{ "year": 2024, "number": 10 }`. Use `based_on` to name the parent
   Act's power and `transposes` for EU law it implements. The explanatory note is not part of the SI.
6. **Constitution.** Call `legislation/legislation_get_constitution_article` with `{ "article": "40", "subsection": "3" }`
   (`lang: "ga"` for Irish). Cite each paragraph by its `ref`, e.g. Article 40.3.3°, and link its `url`.
   In a conflict the Irish text prevails (Article 25.5.4°).
7. **Bill history.** Call `oireachtas/oireachtas_get_bill` with the Act, e.g. `{ "act_year": 2018, "act_no": 7 }`,
   to list its bill's stages, sponsors and versions; or with `{ "bill_year": 2018, "bill_no": 10 }` for a bill, which
   returns the enacted Act's `eli` when it passed. Use `oireachtas/oireachtas_search_bills` to find a bill by title.
8. **EU law.** For an SI's `transposes` ELI or a CELEX number, call `eu-law/eu_law_lookup` with
   `{ "eli": "http://data.europa.eu/eli/reg/2014/536/oj" }` or `{ "celex": "32016R0679" }` for the title, type,
   dates and in-force flag. Only the Official Journal is authentic; cite the EUR-Lex link for reading.

## Output format

```
### <Short title> (No. <n> of <year>), section <s>
> <verbatim text>
Status: as enacted. Directory (updated to <updated_to>): <commencement and amendments, or "no effects listed">.
Sources
- Contains Oireachtas information licensed under the Oireachtas (Open Data) PSI Licence; Irish Statute Book: <url>
Not legal advice.
```

## Rules

- Follow [../_shared/citations.md](../_shared/citations.md).
- Quote, do not paraphrase, when the wording matters. Mark any summary as a summary.
- **No legal advice.** Do not tell the user what they should do or how a court would decide.
  Suggest a solicitor, Citizens Information or the relevant regulator.
- Flag that as-enacted or as-made text may have been amended since; quote `legislation_get_act_effects` evidence.
- Do not present Law Reform Commission Revised Acts text as served by this tool; it is not.
