# Deploying to Azure

The service runs on Azure Functions Flex Consumption (FC1) in North Europe.
`azd` provisions it from `infra/` and deploys the built package.

## What gets created

| Resource | Purpose |
|---|---|
| Resource group `rg-<env>` | Holds everything below |
| Function app (Flex FC1, Node 22, system identity) | `/mcp` (plus `/mcp/x/{source}` for one typed toolset), `/healthz` and the nightly PPR index timer |
| Storage account (no shared keys, no public blobs) | Deployment package, `ppr` index container, `mcpcache` table |
| Application Insights + Log Analytics (1 GB/day cap) | OpenTelemetry traces and metrics, Entra auth only |
| Standard availability test (`enableAvailabilityTest`, default on) | GET `/healthz` every 15 minutes from three EU regions |
| Key Vault (only when `NTA_API_KEY` is set) | Holds the NTA key; the app reads it by Key Vault reference |
| Budget (only when `BUDGET_CONTACT_EMAIL` is set) | Emails at 80% actual and 100% forecast spend |

The app identity gets Storage Blob Data Owner, Storage Table Data Contributor and
Storage Queue Data Contributor on the storage account. It also gets Monitoring Metrics
Publisher on App Insights and Key Vault Secrets User on the vault. No connection
strings or keys are stored in app settings.

Cost controls:
- `MAX_INSTANCE_COUNT` (default 10) caps Flex scale-out.
- Per-IP rate limiting (60 requests a minute) runs in the app.
- Log Analytics has a 1 GB daily cap.
- Optional budget alert (`MONTHLY_BUDGET`, default 20).

## First deploy from a laptop

1. `azd auth login`
2. `azd env new ireland-mcp --location northeurope`
3. Optional: `azd env set NTA_API_KEY <key>`. Get a key from https://developer.nationaltransport.ie/.
4. Optional: `azd env set BUDGET_CONTACT_EMAIL you@example.com`
5. `azd provision --preview` to review the changes.
6. `azd provision`, then `npm run deploy:zip` (needs `az login`).
   Don't use `azd up` or `azd deploy` for the code: they request a remote Oryx build on Flex Consumption,
   which fails for this project. `scripts/deploy-zip.sh` builds locally, ships `dist/` with production
   dependencies, and turns the remote build off.
7. Check it: `curl "$(azd env get-value MCP_ENDPOINT | sed 's#/mcp$##')/healthz"`
8. Build the first PPR index. Either wait for the 03:15 UTC timer, or run `npm run build && AzureWebJobsStorage__accountName=<storage> npm run ppr:build`
   locally after `az login` (needs Storage Blob Data Contributor for your user).
   Until then, `ppr_*` tools use the live per-county CSV fallback.

## GitHub Actions (OIDC)

`.github/workflows/deploy.yml` runs only on manual dispatch.

1. Create an Entra app registration or user-assigned identity.
   Add a federated credential: issuer `https://token.actions.githubusercontent.com`,
   subject `repo:c-mongan/ireland-mcp:environment:production`.
2. Grant it Contributor and User Access Administrator on the subscription.
   User Access Administrator is needed because the template creates role assignments.
   Scope this to a dedicated subscription or resource group if you can.
3. Create a `production` environment in the repo settings.
   Add variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` and `AZURE_ENV_NAME`,
   plus optional `BUDGET_CONTACT_EMAIL`. Add an optional secret `NTA_API_KEY`.
4. Run the workflow from the Actions tab.

## Custom domain (irishopendata.ie)

The apex site lives on the Static Web App. `www.irishopendata.ie` and `mcp.irishopendata.ie` point at the Function App, where `src/functions/redirect.ts` sends allow-listed site aliases (any path) and the MCP root to `https://irishopendata.ie` with a 301, preserving the query string. Other paths on the MCP host are not redirected, and unknown hosts get a 404, so the redirect cannot act as an open redirect. The `azurewebsites.net` and `azurestaticapps.net` URLs keep working.

The Function App uses free App Service managed certificates (Flex site-scoped certificates, two of the three allowed), so no purchased certificate is needed. The DNS zone is in `infra/dns-zone.bicep`. Registration, delegation, bindings, validation and rollback are in [domain-go-live.md](domain-go-live.md).
