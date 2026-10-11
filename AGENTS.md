# Working in this repository

## Autonomy and approvals

The owner prefers Codex to finish authorized work without repeated permission questions. A request to investigate, fix or build authorizes the routine steps needed to deliver a concrete, reviewable result.

- Proceed with repository reads, public-source research, local edits, tests, dependency installation, isolated branches, commits and draft pull requests when they support the requested task.
- Make routine implementation choices and state material assumptions in a brief progress update. Ask only when missing information materially blocks progress.
- Continue after a plan or review finding; do not add an integration menu or approval pause solely because a workflow skill suggests one. Respect the user's existing authorization.
- Keep working on failures and review feedback until the requested result is complete or a specific external blocker remains.
- Get explicit authorization for consequential actions outside the requested scope, such as spending cloud credits, changing production, merging to the default branch, deleting user data or sending messages to other people. Do not ask again for an action already authorized in the conversation.
- Platform-enforced sandbox and connector access controls still apply. Do not bypass them. If one blocks progress, use a permitted alternative where possible and explain the precise blocker once.

## Implementation and validation

Use TDD for new behavior: observe a meaningful failing test, implement the smallest appropriate fix, and rerun relevant checks. Preserve existing source attribution and legal-currentness warnings. Do not claim live coverage, deployment or passing checks without corresponding evidence.

For legal corpus work, run `npm run legal:check`. CI also enables `LEGAL_SOCKET_TESTS=1` and runs the root TypeScript/build checks. Missing local dependencies or socket restrictions must be reported honestly; they do not justify asking the owner to approve routine code changes.
