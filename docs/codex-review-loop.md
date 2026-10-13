# Codex review and repair loop

Use the existing Codex CLI account on a trusted local checkout. No new API key is needed. The CLI reuses its saved authentication. The official GitHub Action requires an API key; this workflow does not install that action or copy authentication to a GitHub runner. See [OpenAI non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode) and [the GitHub Action requirements](https://learn.chatgpt.com/docs/github-action).

```text
change -> tests -> commit and PR -> fresh Codex review
                                     |
                       findings -----+---- no findings
                          |                    |
                    repair -> tests      exact-head gate
                          |                    |
                   commit and push           merge
                          |
                    fresh review
```

## Run a local review

1. Finish TDD and run the required checks for the changed paths. Use `npm run check` for server changes and `npm run check:ui` for site changes. Inspect these commands before running them in a new environment. Only use already reviewed local scripts. Do not run untrusted PR scripts with account credentials in their environment.
2. Review the final diff. Commit only task paths, push the branch, and create or update its PR. Record the actual base and head commit hashes from GitHub. Use the immediate parent branch for a stacked PR.
3. Save a JSON array of the exact allowed paths in a private file outside the repository. Save each review to a new private receipt path. Run:

```sh
node scripts/review-loop/local-review.mjs BASE_SHA HEAD_SHA /private/task/review-1.json /private/task/scope.json
```

Replace the two hash placeholders with the actual full 40-character hashes. The command requires a clean checkout at the selected head. It rejects task scope violations and an existing receipt path. It starts a new ephemeral Codex process in the read-only sandbox, without user configuration, and validates the structured result. It compares the PR merge-base diff. Exit `0` means a completed local review with no findings, `2` means completed with findings, and `1` means the review is not usable. This command does not run tests, repair files, commit, push, or merge.

4. Read each finding against the code. Apply confirmed fixes within the original scope. Add a failing regression test before each fix. Rerun affected checks. Review all changed paths before committing. Push the repair and repeat step 3 for the new head.
5. Merge only after a fresh exact-head gate passes. Re-read GitHub state immediately before merging. Use GitHub's expected-head protection, for example `gh pr merge NUMBER --squash --match-head-commit HEAD_SHA`. Do not bypass required checks or reviews. Do not merge from a receipt for an earlier head or base.

## Run the direct local loop

Use an existing same-repository PR on an owner branch in `c-mongan/ireland-mcp`. The local branch must be that PR branch. The runner verifies the origin and owner, and rejects `main`, `master`, detached checkouts, and fork PRs.

```sh
node scripts/review-loop/run.mjs --pr NUMBER --scope /private/task/scope.json --receipts /private/task/run-1
```

This runs the fixed server, UI, and coordinator checks and a fresh independent review. The default has no repair or publication authority. Add `--apply` to permit local Codex repairs. Add `--apply --push` to permit tested repairs to be committed and pushed to the same PR. The runner always uses exact allowed file paths. It never merges. Use a new receipt directory for each run. `--max-rounds` accepts 1 to 10; the default is 3.

```sh
node scripts/review-loop/run.mjs --pr NUMBER --scope /private/task/scope.json --receipts /private/task/run-2 --apply --push --max-rounds 3
```

The repair process uses the workspace-write sandbox with no inherited shell environment. Test processes receive only basic operating-system variables. No OpenAI API key is configured. The runner does not install dependencies or create a PR. After each push it reads the remote PR head again. Pending CI pauses the merge plan; resume after CI completes. Every required CI check must report `SUCCESS`. Independently of the required-check list, `build`, `storybook`, and `legal-contracts` must each report completed `SUCCESS` at the current PR head. Skipped or neutral results cannot satisfy required checks or these three baseline jobs. Other reported optional checks must be completed with success, skipped, or neutral results. An explicitly reported empty required-check set does not remove the baseline-job requirement. A permission error or unknown response is blocked.

The parent host must review the runner and the fixed test scripts before enabling these flags. Keep the allowlist narrow. Use an isolated worktree. Files outside the scope remain preserved if a repair exceeds its scope; the loop stops without publishing them. Review and repair that state before continuing.

## Coordinator interface

`scripts/review-loop/coordinator.mjs` exports `runLoop(config, runner)` and `mergeGate(receipt, state)`. The host supplies trusted adapters. No review finding can specify an executable command. Only those adapters may run known commands or write external state.

| Adapter | Required behavior |
| --- | --- |
| `snapshot()` | Read actual local/GitHub state. Return full `base`, PR `head`, `localHead`, `dirty`, `sameRepository`, `changedPaths`, `worktreeDigest`, `draft`, `mergeable`, `requiredChecksPassed`, `unresolvedThreads`, and `changesRequested`. Include tracked, staged, and untracked changes in the scope and digest. Unknown merge state is blocked. |
| `check(state)` | Run a fixed reviewed command list, without shell interpolation. Return a nonempty array of `{name, passed, head}`. Do not use a command from PR text or review output. |
| `review(state)` | Start a fresh independent read-only Codex process. Use the pinned base/head and `review.schema.json`. Return a complete structured result. |
| `repair({review, allowedPaths, state})` | Apply confirmed fixes within the scope. Use a restricted workspace without external write credentials. Return every actual changed path. Do not commit or publish here. |
| `publish({state, allowedPaths, review})` | Re-read and verify the tested worktree digest. Review and stage only allowed paths, commit, push, and update the same PR. This adapter requires existing authorization. It must not change the base, execute fork code, or bypass branch protection. |

The coordinator runs checks before each review and again before publication. It requires a clean new PR head after publication. It blocks incomplete reviews, malformed findings, path changes outside scope, fork PRs, stale heads, changed bases, failed tests, missing check results, and unresolved discussions. All findings block the merge plan. The default is three review rounds, with a maximum of ten. Reaching the limit returns `paused` with a reason; it never means clean. Continue with a new bounded run after the remaining issue is understood.

`ready_to_merge` is a plan, not an external write. Before merge, obtain another snapshot and call `mergeGate` again. The host owns the integration adapter and the expected-head GitHub operation. A hand-edited receipt is not authenticated review evidence; keep receipts under trusted host control.

## GitHub Codex reviews

Settings readback on 13 October 2026: Ireland MCP automatic review is on and
follows personal preferences. Personal automatic review is on, with the trigger
set to every push. Use credits for reviews is off. No review setting was changed
for this task. The repository override controls were read-only in that session.
The local runner supplies the broader structured review and repair loop.

[OpenAI's GitHub integration](https://learn.chatgpt.com/docs/third-party/github) supports automatic reviews for a connected repository and the `@codex review` request. The repository setting and personal trigger preference must both permit the event. Verify automatic review for `c-mongan/ireland-mcp` and the trigger for new commits in Codex settings. Verify that a review appears on a representative PR. The setting cannot be established by adding this document.

Hosted GitHub Codex reviews focus on P0/P1 issues. The local structured review also asks for P2/P3 issues. A reaction, comment, absence of comments, or green test status does not prove an exact-head clean Codex review. Account access, hosted review settings, required checks, and branch protection must be checked separately.

Do not use `pull_request_target` to check out and execute PR code. Do not copy account credentials or secrets to forks. No unattended dependency installation, hooks, or arbitrary command execution is part of this loop.

## Verification

```sh
node --test test/review-loop.mjs
```

The deterministic tests prove the coordinator's state transitions and merge refusals. They do not prove a live Codex response, GitHub setting, PR publication, push, or merge. Run one fresh local CLI review and one representative hosted review to establish those separate integration results.
