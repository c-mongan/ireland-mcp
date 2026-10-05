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
