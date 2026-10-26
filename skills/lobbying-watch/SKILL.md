---
name: lobbying-watch
description: Summarises published returns on the Register of Lobbying (Lobbying.ie, Standards in Public Office Commission) for a topic, organisation or designated public official, and links them to Oireachtas members and to related bills, via the Ireland MCP server. Use when someone asks who lobbied on housing, which organisations contacted a Minister or TD, or what lobbying surrounded a bill.
license: MIT
---

# Lobbying watch

Find and summarise lobbying returns, then connect them to the people and legislation they name. The
register records declared activity; it does not show influence or outcomes.

**Related projects:** [Lobbyieng](https://lobbyieng.com/) (Robert McElhinney),
[Dáil Tracker](https://dailtracker.streamlit.app/member-overview) (peweet),
[Oireachtas Connect](https://oireachtasconnect.ie/) (Oireachtas Connect). Not affiliated; see
[../_shared/inspirations.md](../_shared/inspirations.md).

## Calling the tools

Steps name each operation as source/operation (e.g. `lobbying/lobbying_search_returns`), using the typed
tool name as the operation. On the default surface, run it with `ireland_call`, for example:

```json
{ "source": "lobbying", "operation": "lobbying_search_returns", "args": { "query": "housing", "date_from": "2026-01-01", "date_to": "2026-06-30", "limit": 50 } }
```

If an argument shape is unclear, call `ireland_describe` with `{ "source", "operation" }` first;
it returns the schema and an example. `search`, `fetch` and `nearby` are top-level tools. If the
server was added with `?toolsets=<ids>` or `?toolsets=all`, the typed tool can be called directly
with the same `args`.

## Steps

1. **Search returns.** Call `lobbying/lobbying_search_returns` with one of `query` (topic words),
   `lobbyist` (organisation) or `official` (a designated public official's name), plus `date_from` and
   `date_to`. Windows are limited to one year; split longer periods into yearly calls.
2. **Page through.** Use `page` until `possibly_more` is false or you reach a stated cap (e.g. 200
   returns). Report `total` and how many you read.
3. **Summarise.** Count returns by `lobbyist`, `public_policy_area_name` and `subject_matter_name`, and
   list the officials named. Quote the `intended_results_text` briefly with the return `url`.
   Skip obvious test or placeholder returns (e.g. text "TEST") and say how many you skipped.
4. **Link officials to members.** For an official who is a TD or Senator, call
   `oireachtas/oireachtas_search_members` with `{ "name": "<surname>" }` to confirm party and constituency.
5. **Link to legislation (optional).** If returns name a bill, call `oireachtas/oireachtas_search_bills`
   with title words to show its current stage and dates beside the lobbying dates.
6. **Company context (optional).** `cro/cro_search_datasets` points to CRO open data for a
   registered company; describe only what it contains.

## Output format

Illustrative layout; the values are examples, not data.

```
## Lobbying on "housing", 1 Jan–30 Jun 2026 (Register of Lobbying)
Returns found: 916 (read 200). Test/placeholder returns skipped: 3.
| Lobbyist | Returns | Policy areas | Officials named |
|---|---|---|---|
Selected returns: <date> <lobbyist> — "<intended result, short quote>" (<url>)
Sources
- Register of Lobbying, © Standards in Public Office Commission, Lobbying.ie (PSI General Licence), retrieved <date>
```

## Rules

- Follow [../_shared/citations.md](../_shared/citations.md).
- A return is a declaration of activity, not a meeting count and not evidence of influence or
  wrongdoing. Never imply either.
- Same layout for every organisation and official; no adjectives about lobbyists or officials.
- Do not add private contact details; the adapter already omits them.
