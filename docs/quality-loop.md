# Quality checks and repair loop

Use three forms of evidence: local regression tests, hosted protocol checks and real source responses. Visual comparisons and usage events add context. They do not replace those checks.

```text
Live source checks + hosted protocol + PostHog release metrics
                              ↓
                   Reproduce one confirmed fault
                              ↓
             Recorded data fixture or browser regression
                              ↓
                Fix → unit/types/lint → browser checks
                              ↓
             Chromatic comparison → review → deploy
                              ↓
                  Hosted checks and metric readback
```

## Local contributor checks

After `npm ci`, run `npm run check`. It runs lint, types, fixture unit tests, the build, infrastructure/ZIP/status-publishing contracts and a real stdio MCP client. Unit tests use local fixtures; no provider account is required.

For UI work, install Chromium with `npx playwright install chromium`, then run `npm run check:ui`. This checks Storybook types and its actual MCP endpoint, builds the stories, runs production website browser tests and checks the visual fixtures at mobile width with accessibility rules. Production browser tests use mocked external responses; Chromatic supplies a separate hosted visual comparison.

## Hosted protocol

Run:

```bash
npm run build
npm run check:mcp -- --url https://mcp.irishopendata.ie/mcp
```

The check initializes a real MCP client and verifies the default tools, source/operation catalogue, an operation description, resource contents and prompts. It compares the server's metadata with the built source registry. It makes no provider data calls and does not add tool-completion events to PostHog.

Use `--extended` to inspect every operation description and the isolated all/CSO tool surfaces. Extended HTTP checks use pacing to stay within the public request budget. A deadline or schema mismatch fails the check; a stopped or malformed endpoint cannot count as passed. All transports are closed after the check.

The default check belongs in the existing nightly Live smoke workflow. CI checks the built stdio server and the local website flow on each change. Nightly artifacts retain protocol and live-source receipts for 14 days. A protocol check can pass while a provider is unavailable; the two results remain separate.

## Source accuracy

`npm run live:sanity` makes a small set of real source calls through the local MCP server. The same result validator used by the full operation check rejects missing evidence, incorrect operation tags, invalid data shapes and stale data. Its source-specific predicates add semantic checks, such as a named place, population or known station.

`npm run live:all -- --url https://mcp.irishopendata.ie/mcp` checks every operation through the hosted endpoint. Use it after a source or deployment change, not on every commit. It makes real provider requests and can produce operational telemetry. A `NOT_CONFIGURED`, provider refusal, stale result or timeout is an explicit limit, not successful fresh-data proof. NTA needs an operator key; unit tests prove parsing and error behavior without that key.

## Observability

Use the dedicated PostHog project for consented website actions and aggregate MCP completion events. Read fresh results, select the affected source/operation and compare its deployed release with the reviewed change. Setup canaries and live hosted acceptance calls can be included in these events. They do not prove adoption or unique users. The local nightly source checks do not send PostHog events.

Analytics delivery loss is checked locally and reported through bounded service diagnostics. An empty PostHog chart can mean no calls, no consent, dropped events or failed ingestion. Check the service and capture diagnostics before interpreting it. See [observability](observability.md).

The status feed keeps seven days of samples and preserves the status branch's commit history. A failed remote read stops publication. A concurrent publisher is rejected by a normal Git push, which prevents replacement of the published branch.

## Review and deployment

1. Reproduce the fault and add one focused regression before changing the implementation.
2. Run the checks for the affected contracts. Review all changed paths and preserve unrelated work.
3. For a visual change, compare the relevant Storybook states in Chromatic. A workflow with `--exit-zero-on-changes` does not approve a changed baseline.
4. Deploy the reviewed clean revision. ZIP packaging records that actual revision; it refuses a mismatched expected revision.
5. Read back hosted protocol, source results and the release label in live events. Record failures and missing access separately.

A scheduled maintenance agent can inspect these results and prepare a tested repair. It must not treat a metric improvement or unchanged screenshot as permission to accept a baseline, skip checks or expose credentials. Project code and this workflow do not require such an agent for normal contribution.

## Playground scope

The current site tests public MCP queries without login. [Playground and ChatGPT access](playground-auth.md) describes the supported ChatGPT routes and the separate registration needed for a hosted sign-in experience.
