# SDD ledger — plan: docs/superpowers/plans/2026-10-11-irish-legal-mcp.md

Ruling: Execute the user's instruction to build using TDD without another plan-approval pause; the user already authorized implementation. Cost if scope is wrong: reviewable feature-branch changes only.

Ruling: Restore repository text through GitHub and initialize a local feature checkout because git clone's HTTP proxy is unavailable. Original commit SHA: 5032212bc40fca77c842260134c27abd48a44e5c. Cost: local snapshot has no original Git history or binary media; remote PR retains the original tree.

Pre-flight: Tasks 1→2 share Document metadata; 2→3 share atomic commit; 2→4 share exact-version retrieval; 4→5/6 share the service and chat contract. All use the signatures declared in the plan.

Ruling: Keep the core free of third-party runtime dependencies; bridge to the existing SDK dependencies at the gateway/Azure boundary. Cost: local validation cannot cover the root dependency tree until CI or a working package registry is available.

Task 1: complete — 11 source/policy tests observed RED on missing implementation, then GREEN; article validation, canonical identities, dates, tables, footnotes and annotation warnings covered.
Task 2: complete — 13 persistence/evidence tests observed RED then GREEN; full core suite 24/24 passed. Temporary filesystem tests covered exact versions, unchanged-check times, partial writes and concurrent commits.
Ruling: Use `node --test --test-isolation=none` locally and in package scripts. Default isolated test subprocesses fail in this managed runtime; direct-file and nonisolated runs expose the expected assertion failures and run successfully. Cost: test files must avoid shared global state.

Task 3: complete — 9 refresh tests observed RED then GREEN. Robots rules, redirect boundaries, source permissions, size limits, abort deadlines and bounded sitemap discovery covered. A fixture helper initially defaulted known pages to HTTP 404; corrected its default after tracing requests. Full suite 33/33 passed.
Task 4: complete — 6 service, 8 chat and 3 Azure-provider tests observed RED then GREEN; full suite 50/50 passed. Model output requires known citation IDs and exact supporting quotes, falling back to excerpts on invalid output. Generated interpretation remains explicitly unverified; quote validation is not entailment proof.

Task 5: complete — protocol, stdio/CLI, Web handler and object-storage/package delivery tests observed RED then GREEN. Browser assets and HTTP/stdio transports share the tested service. Core validation before review: 66 passed; six socket contracts skipped in this environment.
Ruling: Run actual loopback contracts in CI with LEGAL_SOCKET_TESTS=1. Local binding fails with EPERM; a network permission request was aborted by the user. Direct Request/Response, stream stdio and actual filesystem contracts remain active locally. Cost: native socket adapter verification awaits CI.

Task 6: Azure and gateway adapters, runtime packaging, nightly refresh, opt-in registration, source-policy documentation and local settings implemented. Root dependency-based checks await CI because this workspace has no node_modules and cannot reach its configured proxy. No Azure credentials or live source body access are available here.
Ruling: Register new gateway modules only when LEGAL_ENABLED=true, preserving the existing deployed catalogue until a corpus is deliberately ingested. Cost: operator must enable registration and sync explicitly.
Ruling: Azure chat uses an aggregate per-worker/host limit rather than trusting client-supplied proxy headers. Multiple allowed hostnames are configured explicitly; production defaults to WEBSITE_HOSTNAME. Cost: large public deployments need edge authentication and distributed per-user quotas.

Whole-branch independent reviewer: implementation_review, read-only, original baseline be26e8c through working tree. Five Important findings: truncated XML publication; derived sections failing to show stale state; partial immutable file writes; actual Revised Acts warning wording; historical ranking based on latest text. All five have observed failing regression tests and passing fixes. Additional regressions cover commencement-column semantics, real effects currency heading, actual eISB punctuation, invalid calendar dates, transport truncation and invalid JSON-RPC IDs. Snapshot publication now uses synced temporary files and atomic no-overwrite links, verifies existing bytes, and aborts on corruption. No Critical review finding.
Ruling: Deliver as a draft PR against the known original main commit, retaining its complete original tree, without another integration menu. The user's build authorization and developer instruction to complete a concrete reviewable result authorize the draft PR. Main merge, production ingestion and credit spending remain separate actions.
