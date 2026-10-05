---
name: legislation-lookup
description: Looks up Irish Acts and sections in the Irish Statute Book (eISB) through the Ireland MCP server and quotes the official text with a citation, optionally finding the related Bill in the Oireachtas. Use when someone asks what an Irish Act says, wants the text of a section, or needs to find which Act covers a topic. Gives the text, not legal advice.
license: MIT
---

# Legislation lookup

Find and quote Irish legislation accurately.

## Calling the tools

Steps name each operation as source/operation (e.g. `ppr/ppr_price_stats`), using the typed tool name as the operation. On the
default surface, run it with `ireland_call`, for example:

```json
{ "source": "legislation", "operation": "legislation_list_acts", "args": { "query": "data protection" } }
```

If an argument shape is unclear, call `ireland_describe` with `{ "source", "operation" }` first;
it returns the schema and an example. `search`, `fetch` and `nearby` are top-level tools. If the
server was added with `?toolsets=<ids>` or `?toolsets=all`, the typed tool (e.g. `legislation_list_acts`) can
be called directly with the same `args`.


## Steps

1. **Find the Act.** Call `legislation/legislation_list_acts` with `{ "query": "residential tenancies", "limit": 10 }`.
   Pick by title and year; if several fit, list them and ask.
2. **Get the Act.** Call `legislation/legislation_get_act` with the Act `year` and `number` from
   step 1, e.g. `{ "year": 2018, "number": 7 }` (Data Protection Act 2018). Show the section list.
3. **Get a section.** Call `legislation/legislation_get_section` with `year`, `number` and
   `section` (a string such as "2" or "19A") and quote it verbatim.
4. **Bill history** (optional): call `oireachtas/oireachtas_search_bills` with the Act's short title
   and `year` to show how it passed through the Oireachtas.

## Output format

```
### <Short title> (No. <n> of <year>), section <s>
> <verbatim text>
Status note: the eISB text may not include later amendments; check the Revised Acts on lawreform.ie.
Sources
- Irish Statute Book © Office of the Attorney General (PSI General Licence / CC BY 4.0): <url>
```

## Rules

- Follow [../_shared/citations.md](../_shared/citations.md).
- Quote, do not paraphrase, when the wording matters. Mark any summary as a summary.
- **No legal advice.** Do not tell the user what they should do or how a court would decide.
  Suggest a solicitor, Citizens Information or the relevant regulator.
- Flag that the as-enacted text may have been amended since.
