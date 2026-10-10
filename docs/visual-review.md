# Frontend visual review

Storybook reuses the production HTML and CSS in sandboxed frames. Fixed sample responses replace live requests. The frames block scripts, network access, video, installation links and copy actions. Native query-settings disclosure and response scrolling remain available for keyboard checks.

There are 28 stories. Each theme covers the hero, installer, directory, six query states and five health states. Query states include idle, loading, success, empty, error and a long truncated payload. Health states include loading, healthy, degraded, stale and an unavailable feed. A degraded health sample includes both provider access refusal and a source that needs setup.

Chromatic captures each story at 1280px. Hero and successful-query stories also use 360px. This gives 32 snapshots per full build. Browser tests check all stories at 360px, inspect page errors, block external requests, check iframe sizing, run WCAG A/AA rules on an exact document copy of the section and test keyboard disclosure and response scrolling. The accessibility copy permits the timers needed by axe; the original preview keeps its script-blocking sandbox for all UI checks. These checks prove fixture behavior. Production browser tests and live response checks prove separate behavior.

## Run the checks

1. Run `npm run build-storybook`.
2. Run `npm run test:storybook`.
3. Review the relevant production flow with `npm run test:e2e`.
4. Publish through the existing Chromatic workflow or `npm run chromatic -- --no-interactive --exit-zero-on-changes` with the project token supplied through the environment.
5. Inspect changed snapshots at both widths. Accept a baseline only after the change is reviewed. `--exit-zero-on-changes` permits a build with pending visual changes; it does not accept those changes.

The snapshot frame uses a fixed theme and sample time. It disables animation and smooth scrolling. New fixtures must state that their data is a sample. Do not put a live fetch, analytics capture, secret, current timestamp or random identifier in a fixture. Do not add Storybook-only visual overrides to make a production defect disappear.

## Chromatic and PostHog

```text
Production use → PostHog event or metric → Reproduce the affected state
                                             ↓
Production change ← Browser and data checks ← Fixed Storybook story
        ↓                                      ↓
    Deploy and read back                  Chromatic comparison
        ↓                                      ↓
    Check the metric                     Review changed snapshots
```

PostHog can identify failed queries, slow requests and incomplete user flows when the project has authorised telemetry. Chromatic can show layout changes for a reproducible state. Use the source and operation identifiers to find the relevant story or create a fixed sample. Do not copy raw query arguments, response bodies or personal data into analytics or Storybook. A lower event error rate does not prove data accuracy. A matched snapshot does not prove that a live source works.

Keep reviewed build URLs and commit identifiers with each visual issue. Compare the deployed result with the reviewed commit before closing the issue. Use one specific metric and one reproducible state per iteration.

## MCP support limit

The [Chromatic MCP setup guide](https://www.chromatic.com/docs/mcp/) requires Storybook 10.3 or later and React for the Storybook MCP addon. This project uses Storybook 10.6 with the HTML/Vite renderer. It meets the version requirement but does not use a supported renderer. The addon is not installed. Standard Storybook snapshots, browser checks and Chromatic publishing remain available. Do not claim a working Chromatic MCP endpoint for this project until the renderer is supported or a separately approved architecture change is complete.
