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
| Standard availability test (`enableAvailabilityTest`, default on) | GET `/healthz` every 15 minutes from three EU regions; production custom domains also monitor the site and MCP initialize |
| Key Vault (only when `NTA_API_KEY` is set) | Holds the NTA key; the app reads it by Key Vault reference |
| Budget (only when `BUDGET_CONTACT_EMAIL` is set) | Emails at 80% actual and 100% forecast spend |

The app identity gets Storage Blob Data Owner, Storage Table Data Contributor and
Storage Queue Data Contributor on the storage account. It also gets Monitoring Metrics
Publisher on App Insights and Key Vault Secrets User on the vault. No connection
strings or keys are stored in app settings.

Cost controls:
- `MAX_INSTANCE_COUNT` (default 10) caps Flex scale-out.
- The app rate-limits each client IP to 60 requests a minute per Functions instance. The
  counter is in memory, so it is not shared between instances: one client can reach about
  60 × `MAX_INSTANCE_COUNT` requests a minute in total (600 at the default cap).
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

### ZIP payload permissions

`scripts/deploy-zip.sh` supports a private caller `umask 077`. After installing
production dependencies, it makes only the staged payload readable by all users,
with traversable directories and existing executable bits preserved (`a+rX`).
The temporary staging root and local ZIP stay private; source files and caller
logs are not changed. The staging directory is removed on success or failure.

Do not bypass this normalization when packaging by hand. A ZIP containing
owner-only files (`0600`) or directories (`0700`) can trigger Kudu's
`ZIP permission validation failed` warning and leave the Function host unable
to start, even when the upload succeeds.

Run `node --test test/deploy-zip.mjs` to exercise the real deploy script and ZIP
under `umask 077`. The test substitutes only npm and Azure CLI boundaries, so it
does not install dependencies or write to Azure. CI runs it alongside the
domain-deployment ordering regression.

## GitHub Actions (OIDC)

`.github/workflows/deploy.yml` runs only on manual dispatch.

### Irish legal service rollout

`.github/workflows/deploy-legal.yml` updates the existing Function App without provisioning resources. A change to that workflow on `main` triggers a rollout; subsequent rollouts can use manual dispatch from `main`. The production job grants OIDC access only for a `main` push or a manual dispatch with `refs/heads/main`; dispatches from other refs are skipped. Pull requests run the existing CI workflows and cannot trigger this deployment workflow or obtain its production OIDC token.

On 2026-10-11, the owner authorized making PR #76 ready, iterating on Copilot review, merging the reviewed change and deploying the existing app with its first source refresh. This supersedes the original draft-only implementation scope. The workflow uses the same `production` OIDC identity and `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` variables as the existing deploy workflow. Set `AZURE_RESOURCE_GROUP`/`AZURE_FUNCTION_APP_NAME` if the deployed resource names differ from the documented production app. The 2026-10-11 production run (38167109074) received none of the three Azure login inputs and failed before authentication. Inspect their configured scope and values before rerunning; the log does not establish whether the IDs are absent from GitHub settings or stored only as secrets. No successful deployment is implied by the workflow's presence or CI passing.

The rollout enables `LEGAL_ENABLED` and `LEGAL_SYNC_ENABLED`, keeps Revised Acts storage disabled, configures the Azure/MCP host origins, deploys a prebuilt package from a checked clean revision, invokes the first source refresh using the Function host's admin API, and verifies source coverage and a cited annual-leave answer. It fails if Azure credentials, source access, ingestion or chat evidence is unavailable. Source refresh observes the same robots/licence boundaries as local sync. The host key is held only in memory and is never printed. Azure OpenAI deployment creation is not part of this rollout.

The rollout waits for a distinct completed refresh whose start time is at or after its admin request, then rejects failed refreshes, old required-source observations and stale chat citations. This check assumes synchronized UTC clocks on the GitHub runner and Function worker; clock skew fails verification instead of accepting an older refresh. The deployment receipt includes the refresh ID, timestamps and counts. Also verify that the live MCP catalogue exposes `irish-legal` and `citizens-info`.

For this existing-app rollout, the identity needs permission to read and configure the Function App, deploy its package and retrieve its host key. Role-assignment permissions are required by the infrastructure provisioning workflow below, not by the legal rollout.

#### Authentication preflight

Use `.github/workflows/deploy-legal.yml` to update the existing
`func-ireland-mcp-aofsjpwgy4hva` in `rg-ireland-mcp`. This path does not provision
infrastructure or create Azure role assignments. Reuse the existing deployment
app registration or user-assigned managed identity; do not create a client secret
or substitute the Function App's runtime system-assigned identity.

Before rerunning the rollout:

1. Inspect the GitHub `production` environment's variables and inherited repository
   variables. This workflow reads `vars.AZURE_CLIENT_ID`, `vars.AZURE_TENANT_ID`
   and `vars.AZURE_SUBSCRIPTION_ID`; values stored only as secrets do not populate
   these expressions. Set the three variables to the verified existing deployment
   identity's client ID, directory tenant ID and target subscription ID.
2. Inspect that identity's federated credentials. Match the actual GitHub token's
   subject, issuer `https://token.actions.githubusercontent.com` and audience
   `api://AzureADTokenExchange`. The expected default subject for this repository
   is `repo:c-mongan@60523371/ireland-mcp@1405741576:environment:production`, as described below. Add or correct only the missing exact
   trust on the existing identity after confirming the emitted claim.
3. Verify its existing Azure access covers reading the Function App, updating app
   settings, deploying the package and listing the host key for the first source
   refresh. Do not apply the initial-provisioning subscription roles below just
   to release code. Review any genuinely missing access at the smallest resource
   scope needed.
4. Preserve `environment: production`, the `main` push/manual-dispatch guard,
   job-scoped `id-token: write`, and production environment branch restrictions.
   Once the configuration is ready, rerun the failed production job or manually
   dispatch `deploy-legal.yml` from `main`.

### Initial infrastructure provisioning

1. Create an Entra app registration or user-assigned identity.
   Add a federated credential: issuer `https://token.actions.githubusercontent.com`,
   audience `api://AzureADTokenExchange`, and a subject that exactly matches
   the workflow token. This repository was created on 2026-10-05; GitHub's default
   for repositories created after 2026-07-15 includes immutable owner/repository IDs:
   `repo:c-mongan@60523371/ireland-mcp@1405741576:environment:production`.
   Check the repository's OIDC settings/subject preview or Azure Login's
   `Federated token details` before relying on this value, because a customized
   subject template can change the emitted claim. A legacy name-only subject or
   a `ref:refs/heads/main` subject does not match the default `production`
   environment subject. See [GitHub's OIDC reference](https://docs.github.com/en/actions/reference/security/oidc)
   and [Microsoft's immutable-subject migration guide](https://learn.microsoft.com/en-us/entra/workload-id/workload-identities-github-immutable-subjects).
2. Grant it Contributor and User Access Administrator on the subscription.
   User Access Administrator is needed because the template creates role assignments.
   Scope this to a dedicated subscription or resource group if you can.
3. Create a `production` environment in the repo settings.
   Add variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` and `AZURE_ENV_NAME`,
   plus optional `BUDGET_CONTACT_EMAIL`. Add an optional secret `NTA_API_KEY`.
4. Run the workflow from the Actions tab.

## Custom domains (irishopendata.com live, irishopendata.ie pending)

The apex site lives on the Static Web App `swa-ireland-mcp`. `.github/workflows/deploy-site.yml` uploads `web/` whenever it changes on `main`, using the `AZURE_STATIC_WEB_APPS_API_TOKEN` repository secret. To deploy by hand, run `npx @azure/static-web-apps-cli deploy ./web --env production --deployment-token "$(az staticwebapp secrets list -n swa-ireland-mcp -g rg-ireland-mcp --query properties.apiKey -o tsv)"`. `www.` and `mcp.` hosts point at the Function App, where `src/functions/redirect.ts` sends allow-listed site aliases (any path) and the MCP root to the canonical site (`CANONICAL_SITE_URL`, default `https://irishopendata.com`) with a 301, preserving the query string. Other paths on the MCP host are not redirected, and unknown hosts get a 404, so the redirect cannot act as an open redirect. The `azurewebsites.net` and `azurestaticapps.net` URLs keep working.

The Function App uses free App Service managed certificates (Flex site-scoped certificates; `mcp` and `www` for `.com` use two of the three allowed), so no purchased certificate is needed. The DNS zone is in `infra/dns-zone.bicep`. Registration, delegation, bindings, validation and rollback are in [domain-go-live.md](domain-go-live.md).

Keep Azure platform CORS aligned with the application's configured origin
allowlist. The deployed Functions host intercepts browser preflights even with
an empty platform list; disabling that list blocks browser access rather than
delegating OPTIONS to the application. The application still denies actual
requests from unknown origins with HTTP 403 and permits MCP clients that send
no Origin header. Credentials are not enabled.

After provisioning, verify an OPTIONS request from `https://irishopendata.com`
returns `Access-Control-Allow-Origin: https://irishopendata.com`; a 204 alone
does not prove browser access works. A denied platform preflight may also return
204, but without a CORS grant, so the browser cannot send the actual request.
Platform-generated preflights bypass the application's security headers;
application-generated MCP, health, redirect, and error responses carry them.

### Custom-domain monitoring cost

Retail estimates checked on 2026-10-08 using the
[Azure Retail Prices API](https://learn.microsoft.com/rest/api/cost-management/retail-prices/azure-retail-prices),
in EUR for North Europe, before tax, discounts, or subscription credits:

| Item | Rate | Estimated monthly amount |
|---|---|---|
| Existing public DNS zones (`.com` and `.ie`) | EUR 0.44/zone/month | EUR 0.88; no new zones |
| Public DNS queries | EUR 0.352/million queries (first billion) | Usage-dependent |
| Standard availability tests | EUR 0.0005/execution | EUR 4.32/test for 30 days at three locations every 15 minutes |
| Three tests: site, MCP health, MCP initialize | 25,920 executions/30 days | EUR 12.96 total; EUR 8.64 above the existing single test |
| Metric alerts | First ten monitored metrics free, then EUR 0.088/metric/month | Depends on subscription-wide usage |
| SWA Free, managed certificates, email action group | No fixed charge for these changes | EUR 0 added |

The existing health test is retargeted to the MCP custom domain rather than
duplicated. A 31-day month adds about EUR 8.93 instead of EUR 8.64. Retry
executions, Function invocations, and telemetry ingestion can add usage charges;
the existing EUR 20 budget is an alert, not a spending cap. Keep the Function
scale cap, application rate limit, cache policy, and Log Analytics daily cap.

