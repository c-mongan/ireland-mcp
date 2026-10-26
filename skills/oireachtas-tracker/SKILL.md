---
name: oireachtas-tracker
description: Tracks what the Oireachtas did over a period or on a topic, combining recorded Dáil and Seanad divisions (Tá/Níl/Staon tallies), bills and their latest stage, sitting-day debate headings and parliamentary questions from the Houses of the Oireachtas Open Data API via the Ireland MCP server, with links to the enacted Act where one exists. Use when someone asks what the Dáil voted on this week, where a bill is, what was debated on a date, or how a topic such as housing moved through parliament.
license: MIT
---

# Oireachtas tracker

A dated, cited log of parliamentary activity by period or topic. Use td-briefing for one member and
legislation-lookup for the text of an enacted Act.

**Related projects:** [Oireachtas Explorer](https://oireachtas-explorer.ie) (David Ward),
[Dáil Tracker](https://dailtracker.streamlit.app/member-overview) (peweet),
[Kildare Street](https://www.kildarestreet.com/) (John Handelaar), [Vote TD](https://votetd.ie/) (Frank Conway),
[Oireachtas Vote](https://robmcelhinney.com/OireachtasVote/) (Robert McElhinney), [Rule.ie](https://rule.ie/)
(Unknown). Not affiliated; see [../_shared/inspirations.md](../_shared/inspirations.md).

## Calling the tools

Steps name each operation as source/operation (e.g. `oireachtas/oireachtas_get_votes`), using the typed
tool name as the operation. On the default surface, run it with `ireland_call`, for example:

```json
{ "source": "oireachtas", "operation": "oireachtas_get_votes", "args": { "chamber": "dail", "date_from": "2026-10-01", "date_to": "2026-10-25" } }
```

If an argument shape is unclear, call `ireland_describe` with `{ "source", "operation" }` first;
it returns the schema and an example. `search`, `fetch` and `nearby` are top-level tools. If the
server was added with `?toolsets=<ids>` or `?toolsets=all`, the typed tool can be called directly
with the same `args`.

## Steps

1. **Set the window and chamber.** Default to the last 14 days and the Dáil. Dates are YYYY-MM-DD.
2. **Votes.** Call `oireachtas/oireachtas_get_votes` with `{ "chamber", "date_from", "date_to", "limit": 50 }`.
   Group divisions by `debate` and report subject, outcome and Tá/Níl/Staon. `total` above `limit`
   means more pages exist; say how many you showed.
3. **Bills.** Call `oireachtas/oireachtas_search_bills` with `{ "query": "<title words>", "year": "2025" }`
   (`year` is a string) and optional `status` (Current, Enacted, Lapsed, Withdrawn, Defeated, Rejected).
   Report bill number, title, source (Government or Private Member), sponsors and `latest_stage`.
4. **Enacted Acts.** If a bill has an `act`, call `legislation/legislation_get_act` with its year and
   number for the eISB link; quote sections with `legislation/legislation_get_section`.
5. **Debates.** Call `oireachtas/oireachtas_get_debates` with `{ "chamber", "date_from", "date_to" }`
   for sitting days and section headings. These are headings, not transcripts.
6. **Questions on a topic (optional).** `oireachtas/oireachtas_search_questions` filters by member and
   date, not topic. For a topic, search per member or scan returned subjects, and say how you did it.
7. **Join by date and debate title.** A bill's votes appear under debates whose title contains the
   bill's short title. Match on that and state when a match is uncertain.

## Output format

Illustrative layout; the values are examples, not data.

```
## Dáil, 1–25 Oct 2026
| Date | Debate | Question put | Outcome | Tá | Níl | Staon |
|---|---|---|---|---|---|---|
**Bills that moved:** 2025/83 Residential Tenancies (...) Bill — Second Stage, Dáil, 2026-01-10 (Private Member)
Sources
- Houses of the Oireachtas Open Data API (Oireachtas (Open Data) PSI Licence), retrieved <date>
```

## Rules

- Follow [../_shared/citations.md](../_shared/citations.md); every row carries its date.
- Report tallies and stages exactly; no characterisation of outcomes as wins or losses.
- Division tallies do not say how an individual member voted; do not infer it.
- Treat Government and Private Members' business identically in layout and wording.
