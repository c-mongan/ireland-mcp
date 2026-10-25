# Guidance for contributors and coding agents

Ireland MCP is a read-only Model Context Protocol server for Irish public data.
See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contributor guide.

## Commands

Node 22.12 or later.

```bash
npm ci
npm run typecheck
npm run lint
npm test                 # unit tests replay fixtures, no network
npm run build
npm run inspector:check  # MCP conformance via the Inspector CLI (after build)
npm run dev:http         # local server on http://localhost:7071
npm run legal:check      # legal corpus package checks
```

`npm run live:sanity` and `npm run live:all` call real upstream services; run
them by hand, never in CI.

## Layout

- `src/gateway/`: envelope, errors, caching and tool definition helpers
- `src/sources/<id>/`: one module per upstream source, with fixtures and tests
- `src/registry.ts`: registers source modules
- `packages/irish-legal-mcp/`: optional legal and Citizens Information pilot corpus
- `web/`: static site; `storybook/`: component previews
- `skills/`: packaged user-facing skills; `infra/`: Azure infrastructure as code
- `docs/`: deployment, operations and evidence notes

## Conventions

- Tools are read-only, named `{source}_{verb}`, and return an evidence envelope
  with source, URL, licence, attribution and retrieval time.
- Bound every list and throw `ToolError` with a hint. Never build an upstream
  URL from a user-supplied host.
- Write the failing test first for new behaviour.
- Preserve source attribution and legal-currentness warnings.
- Do not claim live coverage, deployment or passing checks without evidence.
- Never commit secrets, tokens, subscription IDs or personal paths.
- If a check cannot run locally (missing dependency, restricted sockets), say so
  rather than skipping it silently.

CI enables `LEGAL_SOCKET_TESTS=1` and runs lint, typecheck, tests, the build and
the Inspector conformance check.
