# Security policy

## Supported versions

Only the latest release on `main` gets security fixes.

## Reporting a vulnerability

Please report privately with GitHub's **Report a vulnerability** button on the
[Security tab](https://github.com/c-mongan/ireland-mcp/security/advisories/new).
Do not open a public issue.

Include what you found, how to reproduce it, and the impact you expect. You
should get a reply within 7 days. Fixes are credited in the release notes
unless you ask otherwise.

## Scope and design

Ireland MCP is a **read-only, unauthenticated** proxy to public data. Useful
reports include:

- server-side request forgery, or any way to make the server fetch a host
  outside its fixed upstream list
- leaking the operator's NTA API key or any Azure credential
- bypassing the per-IP rate limit, response size bounds or request body limit
- cache poisoning across users, or stale data shown without the `stale` flag
- script injection in the `web/` landing page
- denial of service that costs the operator money beyond the instance cap

Out of scope: wrong or outdated upstream data (report that to the publisher),
and the fact that the endpoint has no authentication — that is by design.

## How the server protects itself

- Upstream hosts are fixed in code; tool arguments only fill typed query
  parameters, never a full URL.
- Inputs are validated with Zod; list sizes are capped at 500 and upstream
  responses at 5 MB.
- The NTA key lives in Azure Key Vault and is never returned in responses or
  error messages.
- The Function App uses a managed identity; Storage has shared keys disabled.
- `maximumInstanceCount` and an optional budget alert cap cost.
