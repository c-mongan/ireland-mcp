# Publishing Ireland MCP

This repo is prepared for the official MCP Registry, but do not publish or submit it from a feature branch.

## Current registry identity

- Current name: `io.github.c-mongan/ireland-mcp`
- Current auth method: GitHub OIDC / GitHub namespace
- Current endpoint: `https://mcp.irishopendata.ie/mcp` (`https://mcp.irishopendata.com/mcp` remains a working alias)
- Registry schema: `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`
- Transport: `streamable-http`
- Package entries: none. The registry manifest is remote-only for now.

The official registry is in preview. Check <https://modelcontextprotocol.io/registry/quickstart>, <https://modelcontextprotocol.io/registry/remote-servers> and <https://modelcontextprotocol.io/registry/github-actions> before a real publish.

## Publish with `mcp-publisher` and GitHub OIDC

1. Confirm the hosted `/mcp` endpoint is public and passes MCP initialize/tools calls.
2. Confirm `server.json` validates against the schema and keeps `name` equal to `package.json#mcpName` while using the GitHub namespace.
3. Create a release tag such as `v1.0.0`, or run the workflow manually.
4. In GitHub Actions, grant:
   ```yaml
   permissions:
     id-token: write
     contents: read
   ```
5. Install the CLI from the official registry releases:
   ```bash
   curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" | tar xz mcp-publisher
   ```
6. Authenticate without secrets:
   ```bash
   ./mcp-publisher login github-oidc
   ```
7. Publish metadata only:
   ```bash
   ./mcp-publisher publish
   ```
8. Verify with the registry API:
   ```bash
   curl 'https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.c-mongan/ireland-mcp'
   ```

The optional workflow in `.github/workflows/publish-registry.yml` implements this as `workflow_dispatch` plus `v*` tags. It intentionally does not publish npm; this manifest is remote-only.

## Later switch to `ie.irishopendata/ireland`

After the domain is bought and controlled:

1. Change MCP endpoint docs and hosted custom domain to `https://mcp.irishopendata.ie/mcp`.
2. Change `server.json#name` and `package.json#mcpName` to `ie.irishopendata/ireland`.
3. Use DNS authentication, because domain-based names require domain auth rather than GitHub auth.
4. Generate a key and TXT record from the official authentication guide:
   ```bash
   MY_DOMAIN="irishopendata.ie"
   openssl genpkey -algorithm Ed25519 -out key.pem
   PUBLIC_KEY="$(openssl pkey -in key.pem -pubout -outform DER | tail -c 32 | base64)"
   echo "${MY_DOMAIN}. IN TXT \"v=MCPv1; k=ed25519; p=${PUBLIC_KEY}\""
   ```
5. Add that TXT record in DNS and wait for propagation.
6. Login with the private key value:
   ```bash
   PRIVATE_KEY="$(openssl pkey -in key.pem -noout -text | grep -A3 'priv:' | tail -n +2 | tr -d ' :\n')"
   mcp-publisher login dns --domain irishopendata.ie --private-key "${PRIVATE_KEY}"
   mcp-publisher publish
   ```
7. Keep the GitHub-namespaced listing only if the registry supports deprecation/redirect metadata; otherwise document the rename in README and release notes.

Do not commit `key.pem` or private key material.

## Directory submissions

Submit only after the hosted endpoint, README, licence, privacy notes and `server.json` are stable.

| Directory | Steps | URL |
| --- | --- | --- |
| Smithery | Open the submission flow, provide the public `/mcp` endpoint or GitHub repo, let Smithery scan/initialize the server, fix any metadata issues, then claim the listing. If adding repo metadata later, add `smithery.yaml` in a separate PR. | <https://smithery.ai/new> or <https://smithery.ai/submit> |
| Glama | Ensure repo topics include `mcp`, `model-context-protocol`, `ireland`, `open-data`. Add `glama.json` if required, then use **Add Server** and provide the GitHub URL or endpoint. | <https://glama.ai/mcp/servers> |
| mcp.so | Use the submit page with type `server`; enter the GitHub repo, endpoint, description, licence and contact email. | <https://mcp.so/submit?type=server> |
| PulseMCP | Direct submissions may be paused; publish to the official MCP Registry first and check whether PulseMCP has ingested the listing. If submissions reopen, submit the registry or GitHub URL. | <https://www.pulsemcp.com/> |
| awesome-mcp-servers | Fork the repo, add one concise line under the most relevant data/open-data category with repo link, description and install note, then open a PR. One server per PR. | <https://github.com/punkpeye/awesome-mcp-servers> |

## Pre-submit checklist

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run inspector:check`
- [ ] `npm run measure:tools` confirms the default surface is lean
- [ ] `npm run live:sanity` passes against the hosted endpoint
- [ ] `PRIVACY.md`, `SECURITY.md`, `NOTICE`, README credits and source/licence tables are current
- [ ] No directory submission or registry publish is done from an unreviewed branch
