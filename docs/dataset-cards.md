# Dataset cards: planning multi-step questions

Every source on this server has a **dataset card**. A card says what the data covers before you fetch
any of it:

| Field | What it tells you | Example (Property Price Register) |
| --- | --- | --- |
| `topics` | Subjects, from a fixed list | property, housing, prices |
| `geo_levels` | The places the data is broken down by | county, point |
| `time` | First and last period, and whether it is a time series | 2010 to present, series |
| `cadence` | How often it changes | daily |
| `dimensions` | The main breakdowns and measures | sale date, price, county, Eircode |
| `join_keys` | Values you can match against another source | county_name, eircode_routing_key, year |
| `freshness` | How current it is, and which date the result carries | appears after Revenue filing; recent months incomplete |
| `auth` | Whether the operator needs a key (otherwise `NOT_CONFIGURED`) | none |
| `examples` | Questions the source answers | median sale price in County Dublin in 2024 |
| `licence` | The source's reuse licence | PSI General Licence / CC BY 4.0 |

A field that nobody has verified says `unknown`, and the card's `unknowns` explains why. Cards are
written by hand from the code and the publisher's documentation. They describe the source; they do not
prove the upstream service is up.

## Geography levels

From coarsest to finest: `national`, `nuts2`, `nuts3`, `county`, `local_authority`, `constituency`,
`lea` (local electoral area), `ed` (electoral division), `small_area`, `town`, and `point` (a
latitude and longitude). The place crosswalk uses the same names.

A **local authority** is not always a county. Cork, Galway and Dublin have several councils each, and
CSO tables labelled "Administrative Counties" are really local authorities. Check the level before you
divide one source's figure by another's.

## How an agent should plan

```text
question ──► 1 find datasets ──► 2 read cards ──► 3 check the joins ──► 4 fetch small ──► 5 compute, cite
             ireland_catalogue   ireland_describe   join_keys, geo,       ireland_call
             (filters)           (source)           time overlap          (filtered)
```

1. **Find candidate datasets with a filtered catalogue call.** Ask for the level and topic you need,
   not for everything:

   ```json
   ireland_catalogue { "geo_level": "lea", "topic": "housing" }
   ```

   Only matching sources and operations come back, each with a compact card. Other filters are
   `join_key` (for example `ed_code`, `member_code`, `eli`), `has_time_series` and `text`. Values are
   forgiving: `"LEA"`, `"local electoral area"` and `"lea"` all work. A topic also matches related
   topics, so `housing` finds property and planning sources.
2. **Read the full card** of each candidate with `ireland_describe { "source": "cso" }`. Check the time
   coverage and freshness: a 2022-only index cannot be compared with a 2024 figure without saying so.
3. **Check the joins before fetching.** Two datasets join when they share a `join_key` at the same
   `geo_level` and their `time` coverage overlaps. If one is at LEA level and the other at county
   level, aggregate the finer one or use the place crosswalk first.
4. **Fetch small.** Call `ireland_describe { "source", "operation" }` for the argument schema, then
   `ireland_call` with filters for just the places and periods you need. Large unfiltered tables are
   truncated.
5. **Compute and cite.** Do the arithmetic yourself, then cite each source's `url`, `licence` and
   retrieval time. Say so if a result is `stale`.

## Finding CSO tables at a geography level

The CSO has thousands of tables, and its keyword search does not know what "council" or "LEA" means.
`cso_search_tables` now ranks by geography level when you name one in the query or pass `geo_level`:

```json
ireland_call { "source": "cso", "operation": "cso_search_tables",
               "args": { "query": "completions", "geo_level": "lea" } }
```

Each result lists its `geo_levels`, worked out from the CSO's dimension names (for example "Local
Electoral Area 2019" is `lea`, and "Administrative Counties" is `local_authority`). Without a level,
the CSO's own order is kept.

When a level is named, the server runs two CSO searches: the topic words, and the topic words plus the
CSO's own name for that level. It puts tables at the requested level first, then related levels
(county and local authority), then the rest. Within each group, titles closer to the topic words and
tables with fewer extra breakdowns come first.

Evidence from live PxStat searches on 26 October 2026:

| Query | CSO search alone | With geography ranking |
| --- | --- | --- |
| `population council` (needs a local-authority population table) | F1004A at rank 49, FY003A at rank 53 | F1004A at rank 2 |
| `completions LEA` | NDA05 not returned | NDA05 at rank 1 |
| `Ukraine LEA` | UA05 not returned | UA05 at rank 1 |

`node evals/multistep/discovery.mjs` re-measures these ranks against a running server.

## Worked example

Question: *"Which LEA had the most new homes completed last year, and what was the median sale price
in its county?"*

1. `ireland_catalogue { "geo_level": "lea", "topic": "housing" }` lists the CSO search, metadata and
   data operations.
2. `cso_search_tables { "query": "new dwelling completions", "geo_level": "lea" }` returns NDA05 first.
3. `cso_get_table_metadata { "table_code": "NDA05" }` gives the latest year and the LEA codes.
4. `cso_get_data` filtered to that year gives the top LEA. Its label names the council, which gives
   the county.
5. `ireland_describe { "source": "ppr" }` shows the PPR is by county from 2010, so
   `ppr_price_stats { "county": …, "from": …, "to": … }` answers the price half.

## Adding a source

Every module in `src/registry.ts` must set `card` (see `src/gateway/cards.ts` for the types and the
fixed lists of topics, levels and join keys). Operations that differ from the source, for example a
single-year profile inside a long-running source, set overrides under `card.operations`.
`src/gateway/cards.test.ts` fails if a card is missing, uses a value outside the fixed lists, or says
`unknown` without a reason.
