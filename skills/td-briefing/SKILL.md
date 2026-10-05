---
name: td-briefing
description: Prepares a factual, cited briefing on an Irish TD or Senator from the Houses of the Oireachtas open data via the Ireland MCP server, covering party, constituency, recent parliamentary questions, recorded votes, debates and bills. Use when someone asks who a TD is, what their local TDs have been raising, how a member voted, or wants to prepare to contact or interview a public representative.
license: MIT
---

# TD briefing

Build a neutral, sourced briefing on one member of the Dáil or Seanad.

## Calling the tools

Each step names a **source** and an **op** as `source.op`. With the default lean surface, call
`ireland_call` with `source`, `op` and `args`, and run `ireland_describe(source, op)` first if you
are unsure of the arguments. If typed toolsets are enabled (`?toolsets=...`, or a server that
lists typed tools), call the op name directly as a tool with the same arguments.


## Steps

1. **Find the member.** Call `oireachtas.oireachtas_search_members` with `{ "name": "Harris" }`,
   or `{ "constituency": "Wicklow" }` to list local TDs. Add `chamber` ("dail" or "seanad") and
   `house_no` if needed. Confirm the right person if several match. Keep the `member_code`
   (e.g. `Simon-Harris.D.2011-03-09`).
2. **Questions.** Call `oireachtas.oireachtas_search_questions` with `member_code`, a date range
   (`date_from`, `date_to`, default the last 3 months) and optionally `type` ("oral" or "written").
   Group the questions by topic and count them.
3. **Votes.** Call `oireachtas.oireachtas_get_votes` for the same window and `chamber`. Report how the
   member's party voted on the main divisions if the member is not listed individually; say which.
4. **Debates.** Call `oireachtas.oireachtas_get_debates` for notable dates; quote headings only.
5. **Bills.** Call `oireachtas.oireachtas_search_bills` with a `query` (member surname or topic) and
   `year` to find bills they sponsored.
6. If the user gave a location instead of a name, find the constituency with
   `geohive.geohive_boundaries_at_point`, then go to step 1.

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
