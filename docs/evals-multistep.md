# Multi-step benchmark

The multi-step benchmark asks the kind of question the catalogue exists for. Each question
combines at least two sources and needs some analysis: joining by place, aligning time
periods, ranking, computing ratios, or reading the law alongside the statistics. It measures
whether an agent can answer such questions today. It also shows which planned capability
would make each failing question answerable: dataset cards, a place crosswalk, server-side
queries or knowledge indexes.

The questions, the reference code and the runner are in `evals/multistep/`.

## Questions

There are 40 questions in three tiers:

| Tier | What it asks | Example |
| --- | --- | --- |
| T1 (12) | A lookup in each of two sources | Galway's Census 2022 population and the Galway West TDs |
| T2 (16) | A join plus arithmetic | Jobseeker's Allowance recipients per 1,000 residents by county, ranked |
| T3 (12) | Three or more sources plus reasoning | Ballymun against Tallaght: deprivation, transport stops and flood risk |

Each question in `questions.mjs` has:

- the question text;
- the sources it needs;
- a sketch of one valid tool path, used only for analysis and never shown to the agent;
- typed answer keys with tolerances;
- a reference function that computes the answer by calling the real tools through `ireland_call`;
- its capability-gap tags.

Eight questions are **controls**. They have the same multi-step shape but need none of the
planned pillars. Comparing them with the rest shows whether a failure comes from a missing
capability or from general multi-step weakness.

## Reference answers

`references.json` pins every reference. Each entry records:

- the as-of date;
- the expected values;
- the exact tool calls used, with each call's URL and retrieval time;
- any client-side workaround the reference needed.

Each question is labelled by how its data changes over time:

- **stable**: published history that should not change. The run compares against the pin.
- **slow**: data that changes occasionally, such as new TDs, late filings or revised series.
  A recompute that differs is reported as `changed`. Check it, then re-pin. A changed value
  is not counted as an agent failure.
- **live**: real-time data such as river levels, the grid or the weather. The run recomputes
  the reference immediately before and after the agent answers, and accepts either value.

A reference fails hard if a tool returns `truncated: true`. This stops the benchmark from
computing answers over partial data.

## Capability gaps

Every gap tag names the pillar that would remove it:

| Tag prefix | Pillar |
| --- | --- |
| `dataset-card:` | Dataset cards in `ireland_catalogue` and `ireland_describe`: geography level, dimensions, coverage |
| `crosswalk:` | A place crosswalk tool: county, local authority, LEA, ED, small area, constituency, NUTS3 |
| `server-query:` | Table handles plus `ireland_query`: server-side joins, counts and aggregates |
| `knowledge:` | Citizens Information and law full-text indexes |
| `source:` | Data that is not in the catalogue at all |

The tags come from three places. None of them is simply a label the author asserts:

1. **Blocked.** The reference throws a `GapError` with evidence. For example,
   `planning_search` caps results at 100 rows and returns no total, so a count of a
   council's planning applications for a year cannot be computed.
2. **Workaround.** The reference works only through a client-side hack, such as a
   hand-written mapping from LEA to county, paging through many results, or a CSO table code
   that search does not surface. The reference records the hack with `ctx.workaround()`.
3. **Agent symptoms.** A failing agent answer is attributed to a pillar only when its
   transcript shows a matching symptom: a truncated payload, repeated searching of the
   catalogue, or the agent saying the data is not available. Otherwise the failure is tagged
   `unattributed`.

Each run also checks the live catalogue for each pillar, looking for a crosswalk tool,
`ireland_query`, a Citizens Information search and dataset-card arguments. When a pillar's
capability appears, any question it blocks changes status to `gap-capability-present`. That
is the cue to write the missing reference.

## Running it

```bash
npm run eval:multistep                         # references only: no model key needed
npm run eval:multistep -- --agent              # also run an agent (skips cleanly without a key)
npm run eval:multistep -- --oracle             # feed the references back as answers (should score 100%)
npm run eval:multistep -- --pin                # refresh references.json after reviewing changes
npm run eval:multistep -- --url https://mcp.irishopendata.ie/mcp   # use the hosted endpoint
npm run eval:multistep -- --only t2-rent-law-rpz --tier T3 --delay-ms 250 --strict
npm run eval:multistep:test                    # offline scorer and item checks (also run in CI)
```

The agent uses the same model settings as `npm run eval`:

- `OPENAI_API_KEY`, with `EVAL_MODEL` to choose the model (default `gpt-4.1-mini`); or
- `AZURE_API_KEY` with `AZURE_API_HOST` and `AZURE_DEPLOYMENT`.

`EVAL_TEMPERATURE=default` is needed for reasoning models.

The agent may take 8 rounds of tool calls in T1, 12 in T2 and 16 in T3. Override this with
`EVAL_MAX_ROUNDS`. Each tool result shown to the agent is capped at 12,000 characters
(`EVAL_MAX_RESULT_CHARS`).

The agent must end its reply with an `ANSWER_JSON` block containing the item's keys.

- A **strict pass** means every key in that block is within tolerance.
- A **lenient pass** checks the free text as well. It is reported separately, so a formatting
  miss does not hide an otherwise correct answer.

The report also records:

- the number of tool calls and tool errors;
- whether every required source appears in the agent's tool trace;
- the failure symptoms and their attributed gaps.

Reports are written to `evals/multistep/out/`, which is ignored by git. The baseline is
[`evals/multistep/baseline.md`](../evals/multistep/baseline.md).

## Nightly run

`.github/workflows/multistep-eval.yml` runs the offline checks every night, then recomputes
the references against a local stdio server. It needs no model key and makes no deployment.
It uploads the report as an artifact and adds it to the job summary.

Upstream outages appear as `upstream_error` and do not fail the run. A reference that breaks
because a tool contract changed appears as `reference_error`. In GitHub Actions it is also
raised as a warning.
