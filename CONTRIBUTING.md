# Contributing

Thanks for helping. Issues and pull requests are welcome.

## Set up

Needs Node 22.12 or later.

```bash
npm install
npm run typecheck && npm run lint && npm test
npm run build && npm run inspector:check   # MCP conformance through the Inspector CLI
npm run dev:http                           # http://localhost:7071 — landing page + /mcp
```

Unit tests never touch the network. They replay recorded fixtures through
`test/helpers/fakeFetch.ts`. `npm run live:sanity` makes one real call per
source; run it by hand, not in CI.

## Frontend Storybook

The separate HTML/Vite Storybook reuses `web/index.html` sections and
`web/styles.css`. It does not alter or deploy the production site.

```bash
npm run storybook          # http://localhost:6006
npm run build-storybook    # generates storybook-static/
npm run test:storybook     # checks the static build in Chromium
```

Stories cover the hero, a Copilot installer, sample source cards, and playground
idle/loading/success/empty/error/truncated states in both themes. They also cover
loading/healthy/degraded/stale/unreachable service status. Hero and successful
query previews include mobile widths. They use fixed sample data, never run live
queries, and disable installation, copy, and video actions.
Each preview is isolated in a sandboxed frame so the site's styles and theme
cannot affect Storybook itself. Dynamic fixtures mirror the generated UI classes;
update them when changing the production renderers in `web/app.js`.

`storybook/demo.css` disables animation and transitions for stable snapshots.
It preserves the production heading sizes. Keep the fixture navigation and
generated classes consistent with the production markup. Browser checks cover
keyboard use, accessibility, responsive layout, and network isolation.

To publish, build first, then supply `CHROMATIC_PROJECT_TOKEN` through your
shell environment or secret manager and run `npm run chromatic`.
Never put the token in repository files or commit it.

The `Chromatic` GitHub Actions workflow builds and checks Storybook on relevant
pull requests, pushes to `main`, and manual runs. It publishes for same-repository
PRs and non-Dependabot pushes/manual runs using the `CHROMATIC_PROJECT_TOKEN`
Actions repository secret. Fork and Dependabot PRs run the local checks only;
never expose the token to enable their publication or use `pull_request_target`
to run their code with secrets.

Visual differences remain pending review in Chromatic and do not fail the
workflow by themselves. Build, browser-check and Chromatic service errors still
fail it. Baselines are not automatically accepted.

## Rules every tool follows

- Name: `{source}_{verb}` in snake_case, for example `met_get_warnings`.
- Read-only. The gateway adds `readOnlyHint` and `openWorldHint` to every tool.
- Return an evidence envelope built with `envelope(info, {...})`: data, source,
  upstream URL, licence, attribution and retrieval time.
- Bound every list with `bound(items, limit)`: default 50, maximum 500. Set
  `truncated` when you cut a list.
- Throw `ToolError` with `BAD_ARGS`, `NOT_FOUND`, `UPSTREAM_DOWN` or
  `RATE_LIMITED`. Add a `hint` that tells the model what to try next.
- Fetch with `ctx.cachedJson` or `ctx.cachedText` and a sensible TTL, so a
  stale copy can be served when the source is down.
- Never build an upstream URL from a user-supplied host.

## Add a source

1. Check the publisher's licence allows reuse, and note its attribution text.
2. Create `src/sources/<id>/index.ts`:

   ```ts
   import { z } from "zod";
   import { HOUR } from "../../gateway/context.js";
   import { bound, envelope, type SourceInfo } from "../../gateway/envelope.js";
   import { ToolError } from "../../gateway/errors.js";
   import { defineTool, type SourceModule } from "../../gateway/module.js";

   export const exampleInfo: SourceInfo = {
     id: "example",
     name: "Example Publisher",
     licence: "CC BY 4.0",
     attribution: "Contains data from Example Publisher, licensed under CC BY 4.0.",
     homepage: "https://example.ie"
   };

   const BASE = "https://api.example.ie";

   export const exampleModule: SourceModule = {
     info: exampleInfo,
     summary: "One line for list_sources and ireland_catalogue.",
     domain: "stats", // one of DOMAINS: stats, transport, environment, energy, law/politics, places/property
     coverage: "What area and period the data covers, and how fresh it is.",
     tools: [
       defineTool({
         name: "example_search_things",
         title: "Search Example things",
         description: "What it returns, when to use it, and the limits.",
         inputSchema: {
           query: z.string().min(2).describe("Words to match"),
           limit: z.number().int().min(1).max(500).optional().describe("Default 50, max 500")
         },
         // Optional: shown by ireland_describe. Otherwise one is derived from required fields
         // (zod examples/default/enum, or an "e.g. ..." hint in the field description).
         example: { query: "housing", limit: 5 },
         async handler({ query, limit }, ctx) {
           const url = `${BASE}/things?q=${encodeURIComponent(query)}`;
           const res = await ctx.cachedJson<{ items: unknown[] }>(url, HOUR);
           if (!res.value.items.length) throw new ToolError("NOT_FOUND", `No things match "${query}".`);
           const { items, truncated } = bound(res.value.items, limit);
           return envelope(exampleInfo, { data: { items }, url, cached: res.cached, stale: res.stale, truncated });
         }
       })
     ]
     // Optional: search(query, limit, ctx) and fetchById(key, ctx) to join the
     // cross-source `search` and `fetch` tools. Ids are "<source>:<key>".
   };
   ```

3. Record real responses into `src/sources/<id>/fixtures/` with `curl`. Trim
   them, and replace any personal data with synthetic values.
4. Write `src/sources/<id>/<id>.test.ts` first (see `geohive.test.ts`). Cover the
   happy path, `BAD_ARGS`, `NOT_FOUND`, an upstream 5xx and truncation.
5. Register the module in `src/registry.ts` (`sourceModules`). That is all the
   wiring needed: each tool becomes an operation in `ireland_catalogue`,
   `ireland_describe` and `ireland_call`; the id becomes a toolset
   (`?toolsets=<id>`, `/mcp/x/<id>`, `--toolsets=<id>`); and the module gets an
   `ireland://sources/<id>` resource. Do not set `pinned` on a tool unless it
   must stay in the default `tools/list` (the budget test caps it at 16,000 chars).
6. Add one call to `scripts/live-sanity.mjs`, a row to `NOTICE`, a card to
   `web/index.html`, and a line to the README tool table.
7. Run `npm run typecheck && npm run lint && npm test && npm run build && npm run inspector:check`.

## Pull requests

Keep each PR to one change, and describe how you tested it. CI runs lint,
typecheck, tests, the Inspector conformance check and CodeQL.
