# First useful result

## Hypothesis

A visitor can select a public-data example, run it, understand the returned result, and inspect its evidence without knowing the MCP protocol. A useful result answers the visitor's question and makes its source and limits clear. A successful HTTP response alone does not meet this condition.

The first-use change should make the result and its evidence easier to find. Before assessing a release, select a concrete question and a known source operation. Check that a visitor can explain what the result means, identify its source, and find the relevant next step. Do not infer this understanding from a control click.

```text
Select example → Run query → Read result → Check source → Choose next step
                    │             │             │               │
                 attempt     technical      source click    connect control
                             completion
```

## Candidate measures

| Signal | What it records | What it does not prove |
| --- | --- | --- |
| `ireland_query_started` | A valid query submission, before its request starts | A completed request or a useful answer |
| `ireland_query_completed`, `outcome: ok` | The website received a technically successful tool result | Correct data, user understanding, or satisfaction |
| `ireland_query_completed`, `outcome: error` | A request or tool failure reached the website | All provider failures or all visitors' attempts |
| `ireland_result_action`, `action: inspect_raw` | A visitor selected the raw response control | That the response was understood |
| `ireland_result_action`, `action: open_source` | A visitor selected the result's source link | That the source page loaded or answered the question |
| `ireland_result_action`, `action: connect` | A visitor selected the result's connection control | A completed installation or successful MCP connection |
| `ireland_install_action`, `action: copy|open` | Configuration was copied or an editor link was selected | A working client connection |

Use event counts by known source, operation, action, outcome, and release. Keep attempts, successful completions, failures, and result actions separate. Current events contain no query or result content, so they cannot determine whether an answer was useful. Verify data contracts and source accuracy separately from product use.

## Evidence required

1. Use local fixtures and browser tests to prove the flow, privacy checks, and event contract. Label this as test evidence.
2. Use a bounded production check to prove ingestion and deployed behavior. Label this as a synthetic check. Keep its time and release in the validation record.
3. Observe a visitor completing a stated public-data task with their consent. Record whether the result answered the task and whether the visitor could identify its source. Do not store private task content in analytics.
4. Compare candidate event counts only after real opt-in traffic exists and known setup checks have been accounted for. State the observation window and release. Set the success condition before making a comparison.

Setup, agent, fixture, and smoke-test traffic are synthetic evidence. The event schema does not classify synthetic traffic automatically. A setup dashboard can prove that capture works; it cannot prove adoption, activation, conversion, or retention. Do not use setup counts to support those claims.

Browser capture requires explicit opt-in and resets identity on reload. It can drop events due to network failure, request limits, page closure, or opt-out. There is no persistent user identity or complete visit denominator. Backend events use one aggregate service identity. These limits prevent reliable user, funnel, and retention claims from this integration. A later activation definition needs evidence of actual value and a separate review of measurement and privacy requirements.

## Review loop

Choose one observed problem, make a bounded change, and check the same task again. Use Chromatic to check visible states and browser tests to check interaction behavior. Use PostHog counts to find patterns that merit inspection. Preserve the selected success condition; do not move it after seeing the data. No automatic redesign, replay capture, or raw-query logging is part of this loop.

This approach follows PostHog's guidance to [define behavior that shows product value](https://posthog.com/docs/new-to-posthog/activation) and [set hypotheses and success conditions before shipping](https://posthog.com/tutorials/validating-what-you-ship). The signals above remain candidate measures until visitor evidence supports them.
