---
name: td-briefing
description: Prepares a factual, cited briefing on an Irish TD or Senator from the Houses of the Oireachtas open data via the Ireland MCP server, covering party, constituency, recent parliamentary questions, recorded votes, debates and bills. Use when someone asks who a TD is, what their local TDs have been raising, how a member voted, or wants to prepare to contact or interview a public representative.
license: MIT
---

# TD briefing

Build a neutral, sourced briefing on one member of the Dáil or Seanad.

## Calling the tools

Steps name each operation as source/operation (e.g. `ppr/ppr_price_stats`), using the typed tool name as the operation. On the
default surface, run it with `ireland_call`, for example:

```json
{ "source": "oireachtas", "operation": "oireachtas_search_members", "args": { "name": "Harris" } }
```

If an argument shape is unclear, call `ireland_describe` with `{ "source", "operation" }` first;
it returns the schema and an example. `search`, `fetch` and `nearby` are top-level tools. If the
server was added with `?toolsets=<ids>` or `?toolsets=all`, the typed tool (e.g. `oireachtas_search_members`) can
be called directly with the same `args`.


## Steps

1. **Find the member.** Call `oireachtas/oireachtas_search_members` with `{ "name": "Harris" }`,
   or `{ "constituency": "Wicklow" }` to list local TDs. Add `chamber` ("dail" or "seanad") and
   `house_no` if needed. Confirm the right person if several match. Keep the `member_code`
   (e.g. `Simon-Harris.D.2011-03-09`).
2. **Questions.** Call `oireachtas/oireachtas_search_questions` with `member_code`, a date range
   (`date_from`, `date_to`, default the last 3 months) and optionally `type` ("oral" or "written").
   Group the questions by topic and count them.
3. **Votes.** Call `oireachtas/oireachtas_get_votes` for the same window and `chamber`. Report how the
   member's party voted on the main divisions if the member is not listed individually; say which.
4. **Debates.** Call `oireachtas/oireachtas_get_debates` for notable dates; quote headings only.
5. **Bills.** Call `oireachtas/oireachtas_search_bills` with a `query` (member surname or topic) and
   `year` to find bills they sponsored.
6. If the user gave a location instead of a name, find the constituency with
   `geohive/geohive_boundaries_at_point`, then go to step 1.

## Output format

```
## <Full name> — <Party>, <Constituency> (<Dáil/Seanad>, term since <date>)
**Questions (<date range>):** <n> total. Top themes: housing (12), health (8) ...
**Recent votes:** <division title> — <Tá/Níl/absent> (<date>)
**Debates:** <date> <heading>
**Bills sponsored:** <bill no./year, title, status>
Sources
- Houses of the Oireachtas Open Data API (Oireachtas (Open Data) PSI Licence), retrieved <date>
```

## Rules

- Follow [../_shared/citations.md](../_shared/citations.md); date every item.
- Strictly neutral. No ratings, opinions, predictions or claims about motives.
- Only report what the API returned. If a member has no questions in the window, say so.
- Do not add personal information beyond the official record.
