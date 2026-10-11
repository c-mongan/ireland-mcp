# Irish legal and Citizens Information MCP

Read-only research tools and a chat page backed by versioned Irish source evidence. Citizen mode prioritises explanatory guidance; lawyer mode prioritises exact provisions. Every answer includes source passages, canonical links, version hashes, attribution and currency warnings. Model credentials are optional: the default answer consists of exact source excerpts.

## Run locally

Use Node 22.12 or newer. The standalone core needs no npm dependencies.

```sh
npm run legal:check
npm run legal:sync
npm run legal:serve
```

Open `http://127.0.0.1:4173`. The stateless MCP endpoint is `http://127.0.0.1:4173/mcp`. The store starts empty; `sync` requires access to publisher sites and respects robots rules. No demonstration fixture is presented as live evidence. Inspect real coverage with:

```sh
node packages/irish-legal-mcp/src/cli.mjs status
node packages/irish-legal-mcp/src/cli.mjs sync --manifest packages/irish-legal-mcp/seeds.json --store .irish-legal-cache
node packages/irish-legal-mcp/src/cli.mjs serve --store .irish-legal-cache --port 4173
```

For VS Code, use an absolute path to the checkout and store:

```json
{
  "servers": {
    "irish-legal": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/ireland-mcp/packages/irish-legal-mcp/src/cli.mjs", "mcp", "--store", "/absolute/path/ireland-mcp/.irish-legal-cache"]
    }
  }
}
```

The CLI also supports `help`, `--host`, and `--manifest`. HTTP defaults to loopback. Set `LEGAL_ALLOWED_ORIGINS` to an explicit comma-separated list when serving another hostname, and set `LEGAL_BEARER_TOKEN` to protect data/chat/MCP requests. The page accepts that token in memory; it is not saved to browser storage.

## Tools and evidence

| Tool | Purpose |
| --- | --- |
| `irish_legal_catalogue` | Permissions, publisher licences and actual coverage |
| `irish_legal_search` | Ranked results with immutable citation identities |
| `irish_legal_fetch` | Document, exact stored version or compatible publisher-dated snapshot |
| `irish_legal_get_provision` | Exact Act section, explicitly enacted or revised |
| `irish_legal_get_changes` | Stored commencement/amendment evidence |
| `irish_legal_research` | Guidance and legal evidence for a query/date |
| `citizens_info_search` | Guidance-only search |
| `citizens_info_get_article` | Guidance with original publisher dates |

The initial manifest covers annual leave and working time, the Organisation of Working Time Act 1997 and its effects page. Extend it with approved source URLs or a bounded sitemap:

```json
{
  "max_pages": 30,
  "seeds": [
    { "source": "citizens-info", "url": "https://www.citizensinformation.ie/en/employment/employment-rights-and-conditions/leave-and-holidays/annual-leave/" }
  ],
  "sitemaps": []
}
```

See [seeds.json](seeds.json) for the actual manifest shape and [source policies](../../docs/irish-legal-source-policies.md) before adding a publisher. Ingestion applies host/path boundaries, robots checks, request pacing, timeouts, response limits and same-source redirects. A failed refresh retains evidence and marks the source and derived sections stale. Raw bytes and parsed versions are immutable; index publication is conditional and atomic. Concurrent refresh conflicts require retrying from the latest index.

The index stores snapshot references, dates, term frequencies and snippets of at most 450 characters. Search ranks this metadata before retrieving only the requested result snapshots. Lexical metadata is limited to 12,000 unique terms and 128 KiB per version; oversized documents fail explicitly rather than losing searchable terms. Complete document bodies live in immutable objects. Older indexes remain readable and migrate on a successful commit. Refreshes that omit previously indexed provisions are rejected as incomplete. Moved Citizens Information pages retain redirect aliases, retire the old search entry and preserve old exact-version citations.

Coverage status includes `last_sync`, written only after the entire manifest finishes, with a unique run ID, start/finish times and success/failure counts. Retained old documents and a queued refresh are insufficient to pass the deployment check.

`as_of` selects a stored publisher-dated snapshot, then ranks that historical text. It does not reconstruct the law operative on that date. Undated/enacted documents without a known compatible version are excluded and reported. Download/check/serve timestamps are separate from consolidation cutoffs. Enacted text does not establish current amended law or commencement. Revised Acts never silently falls back to enacted text. Text longer than 20,000 characters is explicitly marked truncated; consult the publisher for the complete text. Missing results establish only limited indexed coverage.

If different stored texts share a publisher date, historical selection uses the newest retrieved snapshot and warns about the ambiguity. The shared date does not prove which wording applied on the requested date.

## Azure integration

After installing the existing root dependencies, `npm run build` includes the legal runtime/assets in the Functions package. Enable the following application settings on an approved Azure deployment:

| Setting | Use |
| --- | --- |
| `LEGAL_ENABLED=true` | Register the eight operations in the existing gateway; enable `/legal` chat and `/legal/api/status` |
| `LEGAL_SYNC_ENABLED=true` | Refresh the manifest nightly at 03:40 UTC |
| `LEGAL_STORAGE_ACCOUNT` | Blob account name; defaults to `AzureWebJobsStorage__accountName` |
| `LEGAL_BLOB_CONTAINER` | Private container, default `irish-legal` |
| `LEGAL_MANIFEST_PATH` | Optional manifest path inside the deployment |
| `LEGAL_ALLOWED_ORIGINS` | Explicit Azure/custom HTTPS origins, comma separated; defaults to the app's Azure hostname |
| `LEGAL_BEARER_TOKEN` | Optional token protecting legal chat and status; existing gateway access rules still apply separately |
| `AZURE_OPENAI_ENDPOINT` | Optional `https://ACCOUNT.openai.azure.com` |
| `AZURE_OPENAI_DEPLOYMENT` | Existing chat-completions model deployment name |
| `AZURE_OPENAI_API_KEY` | Optional provider key; Functions otherwise uses managed identity |
| `LEGAL_REVISED_ACTS_PERMISSION=true` | Operator attestation of obtained reuse permission; disabled by default |

The Functions identity needs Blob data access to the selected account (the existing infrastructure grants Blob Data Owner on its storage account). An Azure OpenAI identity needs the corresponding inference role. Secrets belong in Azure settings/Key Vault, never in the browser or source manifest. Local standalone model generation currently uses an API key; Functions supports managed identity.

The existing gateway exposes operations through `ireland_call` and its opt-in toolsets. Standalone HTTP/stdio exposes the eight legal tools directly. The Azure chat adapter has an aggregate 30 POST/minute allowance per worker/host to bound usage; this is not a distributed user quota. Configure authenticated user quotas at the edge before opening paid model inference to a large audience. Scale-out multiplies that worker allowance.

Generated claims must cite known documents and include exact supporting quotations; invalid output falls back to excerpts. This checks citation/quote integrity, not the correctness of a legal interpretation. All generated interpretation remains labelled unverified.

Azure subscription credits may cover eligible resources. The available credit balance, benefit restrictions and model-region access must be checked in your own subscription; Visual Studio benefits may restrict production use. This change provisions no resources and spends no credits.

## Validation and operation

`npm run legal:check` runs offline parser, policy, persistence, refresh, chat, protocol and transport contracts. Enable actual network-loopback tests with `LEGAL_SOCKET_TESTS=1 npm run legal:check`; CI does so. After root dependencies and Playwright Chromium are installed, `npm run legal:browser` checks the visible citizen/lawyer/historical chat flows and accessibility using an isolated offline fixture server. Root CI also checks the TypeScript gateway, build and existing server. Live publisher layout changes require a refresh/smoke test before production ingestion. The core has been tested against synthetic guidance/consolidation fixtures and an existing real eISB XML fixture; no complete national corpus is shipped.

File storage is for a single local writer. After an interrupted process leaves `index.lock`, stop all writers, verify no writer is running, remove only that lock and retry. Immutable snapshot corruption fails explicitly and never publishes a new index; restore from a verified backup rather than altering citation versions. Blob storage uses ETags for competing writers. Back up private raw/documents/index objects together.
