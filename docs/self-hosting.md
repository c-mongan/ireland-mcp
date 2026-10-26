# Self-hosting

Most people should use the hosted endpoint, `https://mcp.irishopendata.ie/mcp`. It needs no
keys, no setup and no account. Run your own copy when you want local-only traffic, your own rate
limits or operator keys, or a modified source list.

| Option | Good for | Needs |
| --- | --- | --- |
| [Local stdio](#local-stdio) | One person, one assistant on one machine | Node 22.12+ |
| [Local HTTP](#local-http) | Testing HTTP clients, the website and the playground | Node 22.12+ and a clone |
| [Your own Azure deployment](#your-own-azure-deployment) | A shared endpoint for a team | An Azure subscription |

Local stdio and local HTTP send no telemetry. Product usage counts (PostHog) stay off unless you
set the `IRELAND_MCP_POSTHOG_*` settings described in [observability](observability.md). An Azure
deployment from the templates also creates Application Insights, which receives the gateway's
OpenTelemetry traces and metrics (no argument values or IP addresses; see [PRIVACY.md](../PRIVACY.md)).
Set `IRELAND_MCP_OTEL=off` on the Function app to turn that export off.

## Local stdio

```bash
npx -y ireland-mcp
```

Most clients take it as a command. For example, in Claude Code:

```bash
claude mcp add ireland -- npx -y ireland-mcp
```

Or as JSON:

```json
{ "mcpServers": { "ireland": { "command": "npx", "args": ["-y", "ireland-mcp"] } } }
```

Add typed tools with `--toolsets=cso,irish-rail` or `--toolsets=all`. The default surface is
seven tools.

## Local HTTP

```bash
git clone https://github.com/c-mongan/ireland-mcp
cd ireland-mcp
npm ci && npm run build
npm run dev:http        # http://127.0.0.1:7071/mcp, plus the website at /
```

`PORT`, `HOST`, `RATE_LIMIT_PER_MINUTE` and `MCP_ALLOWED_ORIGINS` are read from the environment.

The website's playground calls the endpoint named in `<meta name="mcp-endpoint">` in
`web/index.html`, which is the hosted service. To try your local server from the playground,
change it to `http://127.0.0.1:7071/mcp` locally (don't commit that). MCP clients pointed at
`http://127.0.0.1:7071/mcp` use your local server directly.

## Operator keys

Every source works without keys except these two:

| Setting | Source | Where to get it |
| --- | --- | --- |
| `NTA_API_KEY` | NTA GTFS-Realtime | <https://developer.nationaltransport.ie> |
| `LOGAINM_API_KEY` | Logainm placenames | Gaois operator registration, <https://docs.gaois.ie> |

Set them in the environment for stdio and local HTTP, or as Function app settings on Azure.

## Your own Azure deployment

The repository includes the Bicep templates and an `azd` project used for the hosted service.
They create a Flex Consumption Function app, storage, Application Insights and a budget alert.

```bash
azd auth login && az login
azd env new my-ireland-mcp
azd env set AZURE_LOCATION northeurope
azd env set BUDGET_CONTACT_EMAIL you@example.com   # optional cost alert
azd provision          # creates the resources
npm run deploy:zip     # builds locally and uploads the code
```

Don't use `azd up` or `azd deploy` for the code. They ask Flex Consumption for a remote build,
which fails for this project; `scripts/deploy-zip.sh` builds locally instead.

Before you deploy a fork:

- **Keep `ENABLE_PRODUCTION_DOMAINS` unset (false).** The custom-domain resources are for
  `irishopendata.ie` only.
- **Set `MCP_ALLOWED_ORIGINS`** if you host your own website that calls the endpoint from a browser.
- **Rename the registry identity before publishing a fork.** That's `mcpName` in
  `package.json`, `name` in `server.json`, and the endpoint URLs. Don't publish under
  `io.github.c-mongan/ireland-mcp`.
- **GitHub Actions:** deploy, status, live-smoke and registry workflows only run in
  `c-mongan/ireland-mcp`. Copy and adapt them, with your own OIDC identity, if you want automated deploys.

Full details, including the GitHub OIDC setup and ZIP deploy, are in [deploy.md](deploy.md).
