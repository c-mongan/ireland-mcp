# Irish Legal MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete source-to-chat Irish legal and citizen-information MCP addition using failing-first tests.

**Architecture:** A dependency-free Node core owns parsing, versioned evidence and research. Existing TypeScript source modules adapt it to the MCP gateway; Azure Functions inject Blob storage through the existing SDK and managed identity. A local HTTP/stdio runner and chat page use the same services.

**Tech Stack:** JavaScript ES modules, Node >=22.12 built-ins, node:test, existing TypeScript/Zod/MCP/Azure dependencies.

**Spec:** `docs/superpowers/specs/2026-10-11-irish-legal-mcp.md`

## Global Constraints

- No production behavior before its failing test.
- Canonical source links, licence and attribution travel with each record and citation.
- Missing legal dates and incomplete coverage remain explicit; source freshness never proves current law.
- Read-only public tools; controlled source ingestion runs separately.
- Revised Acts and judgments require explicit source-specific reuse authorization.
- Tests run offline with real temporary stores and loopback HTTP services.

## Review Focus

- Missing/malformed article bodies must fail ingestion, preserving the last usable snapshot.
- Historical queries must never return an incompatible latest version.
- Withdrawn pages and failed refreshes must remain visible as stale/unavailable evidence.
- Redirects, robots rules and source URLs must prevent arbitrary-site/private-network retrieval.
- Generated answers must reject unknown citations and preserve unincorporated-amendment warnings.

### Task 1: Source parsing and policy

**Files:** `packages/irish-legal-mcp/src/html.mjs`, `sources.mjs`, `policy.mjs`; `test/sources.test.mjs`, `test/policy.test.mjs`.
**Interfaces:** `parseSource({source,url,body,fetchedAt}) -> Document[]`; `sourcePolicy(source, permissions) -> Policy`; `assertSourceUrl(url, source)`.
- [ ] Write tests for guidance links/tables/dates, enacted provisions, revised annotations/currency, effects/commencement, malformed bodies and restricted sources.
- [ ] Run tests and observe missing behavior fail.
- [ ] Implement structured HTML extraction and source policies; keep annotations and warnings.
- [ ] Run tests until green; record evidence in the ledger and commit.

### Task 2: Versioned store and search

**Files:** `src/store.mjs`, `index.mjs`, `evidence.mjs`; `test/store.test.mjs`, `test/evidence.test.mjs`.
**Interfaces:** `createRepository(backend)` produces `commit(documents, raw)`, `search(query, options)`, `get(id, options)`, `status()`; `FileBackend` and injected `BlobBackend` implement conditional index commits.
- [ ] Test immutable raw snapshots, atomic commit failure, unchanged checks, historical selection, ranking, provenance and concurrent updates.
- [ ] Observe failures before implementation; implement the minimal store/index/evidence behavior.
- [ ] Run the complete core suite, record results and commit.

### Task 3: Controlled refresh and coverage

**Files:** `src/ingest.mjs`, `seeds.json`; `test/ingest.test.mjs`.
**Interfaces:** `syncSources(repository, manifest, {fetch,now,permissions}) -> report`.
- [ ] Test robots disallow/allow, rate/size/time bounds, redirects, a failed refresh preserving prior data, and blocked reuse permissions.
- [ ] Observe RED, implement refresh and crawl discovery, run GREEN, record and commit.

### Task 4: Research and grounded chat

**Files:** `src/service.mjs`, `chat.mjs`, `azure-openai.mjs`; `test/service.test.mjs`, `test/chat.test.mjs`.
**Interfaces:** `createService(repository)` exposes catalogue/search/fetch/provision/changes/research; `answerQuestion(service, question, options)` returns answer, citations, warnings, coverage; optional model callback.
- [ ] Test exact citations, guidance versus legislation, unavailable historical evidence, stale warnings, irrelevant evidence and invented model citations.
- [ ] Observe RED; implement shared tools and cited chat, test the Azure model boundary with loopback HTTP, run GREEN and commit.

### Task 5: MCP transports and chat application

**Files:** `src/protocol.mjs`, `server.mjs`, `cli.mjs`, `ui/`; `test/protocol.test.mjs`, `test/http.test.mjs`, `test/cli.test.mjs`.
**Interfaces:** `handleRpc(service, request)`, `createHttpServer(service, options)`, line-delimited stdio runner; GET chat page and POST chat endpoint.
- [ ] Test MCP initialize/list/call/resources round trips, invalid arguments, message limits, safe origins/auth, UI assets and actual HTTP chat flow.
- [ ] Observe RED; implement transports/UI/CLI, run GREEN, record and commit.

### Task 6: Existing gateway, Azure and delivery

**Files:** `src/sources/irish-legal/`, `src/sources/citizens-info/`, `src/functions/legalTimer.ts`, `legalChat.ts`, `src/registry.ts`, `scripts/copy-assets.mjs`, `package.json`, `.github/workflows/`, docs.
**Interfaces:** TypeScript adapter returns `SourceModule` and injected Blob backend; timer runs controlled sync, chat route uses the shared service.
- [ ] Write failing tests for adapter tool behavior and package delivery assets before changing production integration.
- [ ] Implement source modules, registry, managed-identity Blob adapter and configuration docs.
- [ ] Run package checks and all available root checks; record any environment limitations.
- [ ] Obtain an independent code review; fix important findings through RED→GREEN.
- [ ] Publish a new branch and draft PR; verify CI if available. Leave deployment and production ingestion for separately authorized work.
