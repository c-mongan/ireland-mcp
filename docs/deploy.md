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

The apex site lives on the Static Web App (Free SKU). The MCP endpoint, `www.irishopendata.ie` and the `.com` aliases point at the Function App, where `src/functions/redirect.ts` sends allow-listed site aliases (any path) and the MCP root to `https://irishopendata.ie` with a 301, preserving the query string. Other paths on the MCP host are not redirected. Unknown hosts get a 404, so the redirect cannot act as an open redirect. The `azurewebsites.net` and `azurestaticapps.net` URLs keep working.

| Host | DNS records (registrar DNS) | Azure binding |
|---|---|---|
| `irishopendata.ie` | TXT validation token + A record to the SWA's apex IP | Static Web App; step 2 |
| `www.irishopendata.ie` | CNAME to the Function App default host + TXT `asuid.www` | Function App; step 3 |
| `mcp.irishopendata.ie` | CNAME to the Function App default host + TXT `asuid.mcp` | Function App; step 3 |
| `irishopendata.com` | A to the Function App inbound IP + TXT `asuid` | Function App; step 3 |
| `www.irishopendata.com` | CNAME to the Function App default host + TXT `asuid.www` | Function App; step 3 |

1. Use Bash and a current Azure CLI. Sign in with `az login`, then replace the resource values below (the apps may be in different resource groups):

   ```bash
   set -euo pipefail
   SUBSCRIPTION_ID="<subscription-id>"
   SWA_RG="<static-web-app-resource-group>"
   SWA_NAME="<static-web-app-name>"
   FUNC_RG="<function-app-resource-group>"
   FUNC_NAME="<function-app-name>"
   az account set --subscription "$SUBSCRIPTION_ID"
   az staticwebapp show --name "$SWA_NAME" --resource-group "$SWA_RG" \
     --query defaultHostname --output tsv
   az resource show --resource-type Microsoft.Web/sites \
     --name "$FUNC_NAME" --resource-group "$FUNC_RG" \
     --query "properties.{host:defaultHostName,id:customDomainVerificationId,ip:inboundIpAddress}"
   ```

   Use the returned verification ID for every Function App `asuid` TXT record in the table, in the corresponding `.ie` or `.com` DNS zone. `az functionapp show` returns nulls for the verification ID and inbound IP on Flex Consumption.

2. Request the apex SWA binding and read its validation token:

   ```bash
   az staticwebapp hostname set --name "$SWA_NAME" --resource-group "$SWA_RG" \
     --hostname irishopendata.ie --validation-method dns-txt-token --no-wait
   az staticwebapp hostname show --name "$SWA_NAME" --resource-group "$SWA_RG" \
     --hostname irishopendata.ie
   ```

   Publish the returned `validationToken` as the apex TXT record (if it is not yet populated, rerun `hostname show`). Add the apex A record using the IP shown in the Static Web App portal's custom-domain wizard. Wait for DNS propagation and for `hostname show` to report `Ready`; SWA manages the apex certificate.

   If `www.irishopendata.ie` was previously bound to the SWA, remove that binding before moving its DNS and binding to the Function App:

   ```bash
   az staticwebapp hostname delete --name "$SWA_NAME" --resource-group "$SWA_RG" \
     --hostname www.irishopendata.ie --yes
   ```

3. Publish the Function App DNS records from the table and wait for propagation. Then bind each hostname, issue its managed certificate and attach it with SNI:

   ```bash
   for HOSTNAME in mcp.irishopendata.ie www.irishopendata.ie irishopendata.com www.irishopendata.com; do
     az functionapp config hostname add --name "$FUNC_NAME" --resource-group "$FUNC_RG" \
       --hostname "$HOSTNAME"
     CERT_THUMBPRINT=$(az functionapp config ssl create \
       --name "$FUNC_NAME" --resource-group "$FUNC_RG" --hostname "$HOSTNAME" \
       --query thumbprint --output tsv)
     if [[ -z "$CERT_THUMBPRINT" || "$CERT_THUMBPRINT" == "None" ]]; then
       echo "Certificate issuance incomplete for $HOSTNAME; wait and retry before binding." >&2
       exit 1
     fi
     az functionapp config ssl bind --name "$FUNC_NAME" --resource-group "$FUNC_RG" \
       --hostname "$HOSTNAME" --certificate-thumbprint "$CERT_THUMBPRINT" --ssl-type SNI
   done
   ```

4. After deploying the redirect function, check both redirects (expect 301 with the full query in `Location`) and the MCP health endpoint:

   ```bash
   curl -I 'https://mcp.irishopendata.ie/?utm_source=deployment-check'
   curl -I 'https://www.irishopendata.ie/install?utm_source=deployment-check'
   curl --fail-with-body 'https://mcp.irishopendata.ie/healthz'
   ```

Command references: [Static Web App hostnames](https://learn.microsoft.com/en-us/cli/azure/staticwebapp/hostname), [Function App hostnames](https://learn.microsoft.com/en-us/cli/azure/functionapp/config/hostname), [Function App certificates](https://learn.microsoft.com/en-us/cli/azure/functionapp/config/ssl).
