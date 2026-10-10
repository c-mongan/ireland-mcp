# Usage metrics and service health

Ireland MCP keeps service health and product usage separate. Azure Monitor provides service traces and upstream timings. PostHog counts selected actions and completed source operations. Chromatic compares rendered Storybook states. These tools provide different evidence; none proves that a public source is correct.

```text
Source operation → safe scalar event → bounded queue → PostHog dashboard
Browser opt-in   → known action      → bounded capture → PostHog dashboard
Storybook state  → screenshot        → Chromatic visual review
```

## PostHog setup

Use a dedicated Ireland MCP project. Enable **Discard IP data** in that project. The event payload also sets `$geoip_disable: true`, `$ip: "0.0.0.0"`, and `$process_person_profile: false`. No person profiles or user accounts are identified.

Configure the Azure Function with:

| Setting | Value |
| --- | --- |
| `IRELAND_MCP_POSTHOG_ENABLED` | `true` enables capture. All other values disable it. |
| `IRELAND_MCP_POSTHOG_KEY` | The project's ingestion token. Use the deployment secret/configuration path. |
| `IRELAND_MCP_POSTHOG_HOST` | `https://eu.i.posthog.com` or `https://us.i.posthog.com`, matching the project region. |
| `IRELAND_MCP_RELEASE` | Optional reviewed Git commit. Only 7–40 lowercase hexadecimal characters are accepted. |
| `IRELAND_MCP_TELEMETRY` | `off` disables structured tool logs and PostHog capture. |

PostHog stays off if any required setting is absent or invalid. The CLI does not configure this integration; the Azure MCP entry point supplies the known source and operation labels from its registry.

ZIP deployment preserves existing Function settings. If you provision the environment again, pass these settings through the secure `additionalAppSettings` parameter in `infra/main.bicep`. Its empty default does not preserve settings added through the Azure CLI. Keep the ingestion token in the existing private deployment configuration, outside Git.

For the website, `/analytics-config.json` contains `{ "enabled": false }` by default. The deployment process can replace this with `enabled: true`, the project's public ingestion `token`, and its exact `host`. Optional `release` uses the same commit validation. The ingestion token can only submit events. Do not put a personal API key in this file. Both official ingestion hosts are in the site's content security policy.

Visitors must select **Enable usage metrics** before any usage event is sent. This choice lasts for the open page only. A reload resets the choice and creates a new random identity after the next opt-in. The module uses no analytics cookies, local storage, or session storage. DNT and Global Privacy Control override the choice. **Disable usage metrics** stops capture and cancels pending requests. Existing events cannot be recalled.

The browser sends requests directly to PostHog after opt-in. PostHog receives the network connection and its IP address; the project setting controls IP removal from stored events. The site's referrer policy prevents page URL disclosure. The browser sends no URL, referrer, browser metadata, user-entered label, query arguments, result, error message, header, or account identifier in the event payload. No SDK, automatic event capture, session replay, or remote script is loaded.

## Event contract

All events have `schema_version: 1`, `surface: mcp|web`, and the three privacy properties described above. Optional `release_commit` links the deployed change to its Chromatic review. It is sent only when deployment configuration supplies a validated Git commit. Unknown labels become `_OTHER`. The event builder selects each property; it does not copy arbitrary objects.

| Event | Allowed product properties |
| --- | --- |
| `ireland_mcp_tool_completed` | `source`, `operation`, `outcome: ok|error`, `duration_ms`, optional Boolean `cached` and `stale`, optional `error_code` |
| `ireland_query_completed` | `source`, `operation`, `outcome: ok|error`, `duration_ms` |
| `ireland_install_action` | `client: vscode|cursor|claude|chatgpt|copilot|gemini|windsurf|generic|endpoint`, `action: select|copy|open` |
| `ireland_theme_changed` | `theme: light|dark` |

The backend accepts labels from the deployed source registry. The website accepts labels from its maintained static catalogue. Valid error codes are `UPSTREAM_DOWN`, `NOT_FOUND`, `BAD_ARGS`, `RATE_LIMITED`, `NOT_CONFIGURED`, and `_OTHER`. Durations are rounded to whole milliseconds and limited to 0–120,000 ms. Backend capture covers executed source tools; it does not count every HTTP request or rejected request.

## Delivery limits and interpretation

Backend capture stores at most 50 events in memory. The Azure handler awaits a flush before it returns. A flush sends at most two batches, with a 250 ms transport deadline per batch and a 500 ms total budget. Concurrent invocations share an active flush. Capture itself does not wait for the network. Failures, full queues, interrupted workers, and short deadlines can drop events. No retry or durable queue is used. An unavailable analytics endpoint must not fail a source query.

All backend events use the fixed identity `ireland-mcp-service-aggregate`. Use **event counts**, error fractions, and latency distributions. Do not interpret this identity as a user count, session count, conversion funnel, or retention measure. Browser identities also reset on reload, and browser metrics include only visitors who opt in. They cannot measure all visits or the full population.

Browser capture allows at most 30 events per minute and two requests at the same time. Each request has a two-second cancellation deadline. There is no background queue or unload delivery. Failed requests are dropped without displaying their exception. Install `copy` means the clipboard accepted the configuration; install `open` means a link was selected. Neither proves installation in an MCP client.

Use Chromatic for appearance and interaction regressions. Use PostHog to find frequent actions and failed or slow operations. Reproduce a suspected issue in the browser with test data before changing the design. Compare visual variants with Chromatic; use the safe event dimensions to assess the deployed result. Do not enable replay or raw query logging to make this comparison.

## Verification

The backend tests check opt-in configuration, scalar projection, unknown-label redaction, queue size, network rejection, HTTP failure, cancellation, shared flush, and `IRELAND_MCP_TELEMETRY=off`. Browser tests check opt-in/out, DNT/GPC, ephemeral identities, absent cookies/storage, query/result redaction, arbitrary-event rejection, bounded capture, and unaffected UI after analytics failure.

After deployment, read back the Function configuration without printing tokens. Verify the site's configuration by its enabled state and host only. Trigger one known source operation and one opted-in website action. Confirm their safe event properties in the dedicated PostHog project. Local mocked tests alone do not prove live ingestion.

References: [PostHog capture and batch API](https://posthog.com/docs/api/capture), [PostHog IP handling](https://posthog.com/tutorials/web-redact-properties#hiding-customer-ip-address), and the [PostHog core privacy property implementation](https://github.com/PostHog/posthog-js/blob/main/packages/core/src/posthog-core-stateless.ts).
