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

## Storybook and Chromatic MCP

The official `@storybook/addon-mcp` is installed. Storybook uses a small React/Vite `SectionPreview` adapter to publish a component manifest. The adapter still renders the production HTML and CSS in the same sandboxed frame. React is a development dependency; the production website remains vanilla HTML, CSS and JavaScript. The preview is not a public export of the `ireland-mcp` package.

Start the local MCP with `npm run storybook`. It binds to the local interface. Its endpoint is `http://localhost:6006/mcp`. The local server exposes documentation and development tools. Existing Playwright tests provide browser and accessibility checks; the optional Storybook Vitest addon is not installed, so MCP `test-run` is unavailable.

Run `npm run typecheck:storybook` and `npm run test:storybook-mcp`. The MCP check starts an owned server on port 6007, calls the real protocol, checks all 28 story IDs, reads component properties and sample-data constraints, reads an error story, requests its preview, and stops the server. CI runs these checks before publishing.

The published endpoint is [Ireland MCP on Chromatic](https://main--6ac8158d1a7f2613c29bb35a.chromatic.com/mcp). Chromatic exposes only the documentation tools: `docs-list`, `docs-show` and `docs-show-story`. Check a published build with `npm run test:storybook-mcp -- <published-mcp-url>`. A successful local check does not prove that the hosted endpoint works.

For Codex, add the published endpoint with `codex mcp add ireland-chromatic --url https://main--6ac8158d1a7f2613c29bb35a.chromatic.com/mcp`. If Chromatic requires authentication, use `codex mcp login ireland-chromatic` and its normal OAuth flow. Keep credentials out of repository configuration. Restart the MCP connection after adding a server to an already running agent.

Before a visual change, use `docs-list` with `withStoryIds: true`, then `docs-show` for `ireland-mcp-sections`. Use `docs-show-story` to read the affected sample state. Use the local `stories-preview` tool to open it. Read the documented properties before setting an argument. Change the production source, run the checks, publish, and review the Chromatic comparison. PostHog supplies the release and source/operation metrics that identify the state to inspect; these MCP tools supply the matching preview context.

See the [Chromatic MCP guide](https://www.chromatic.com/docs/mcp/) and [Storybook MCP documentation](https://storybook.js.org/docs/ai/mcp/overview).
