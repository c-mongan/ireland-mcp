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
| `irishopendata.ie` | TXT `_dnsauth` validation token + A record to the SWA's apex IP | Static Web App; step 2 |
| `www.irishopendata.ie` | CNAME to the Function App default host + TXT `asuid.www` | Function App; step 3 |
| `mcp.irishopendata.ie` | CNAME to the Function App default host + TXT `asuid.mcp` | Function App; step 3 |
| `irishopendata.com` | A to the Function App inbound IP + TXT `asuid` | Function App; step 3 |
| `www.irishopendata.com` | CNAME to the Function App default host + TXT `asuid.www` | Function App; step 3 |

The supported direct-to-Function TLS path below uses **one CA-issued SAN certificate** covering all four Function hostnames, uploaded as a password-protected PFX with its private key, full intermediate/root chain and server-authentication usage. Obtain it from your certificate provider (DNS validation lets you obtain it before moving traffic). This is a prerequisite; the runbook does not issue it. Four free single-host certificates exceed Flex's three-private-certificate limit. Flex site-scoped certificate management requires ARM/Bicep or the portal, not `az functionapp config ssl`.

`infra/service.bicep` opts **new apps** into `siteScopedCertificatesEnabled`. Adding that flag to an existing app does not migrate it. If the current app was created without it, create a replacement in a **new azd environment**, keeping the old deployment and DNS values for rollback. A TLS front end would avoid recreation but adds another paid service; this approach retains FC1 and the existing redirect handler.

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

   Publish the returned `validationToken` at `_dnsauth.irishopendata.ie` (host `_dnsauth` in the `.ie` zone), rather than an unspecified apex TXT record. If the token is not yet populated, rerun `hostname show`. Confirm the TXT **record name** in the portal's custom-domain validation pane for this binding: Microsoft's apex guide and zero-downtime guide currently give different names (`@` and `_dnsauth.www.<domain>` respectively). If the pane requests a different name, use that exact name. Add the apex A record using the IP shown in the Static Web App portal's custom-domain wizard. Wait for DNS propagation and for `hostname show` to report `Ready`; SWA manages the apex certificate.

   If `www.irishopendata.ie` was previously bound to the SWA, remove that binding before moving its DNS and binding to the Function App:

   ```bash
   az staticwebapp hostname delete --name "$SWA_NAME" --resource-group "$SWA_RG" \
     --hostname www.irishopendata.ie --yes
   ```

3. For an existing app without the creation-time opt-in, provision and deploy the replacement first. Choose an unused environment name and the same subscription. Reapply any optional NTA key, Origin allowlist, budget and scale settings from the old environment before provisioning; they are not copied automatically.

   ```bash
   OLD_ENV=$(azd env get-value AZURE_ENV_NAME)
   azd env new ireland-mcp-tls --location northeurope --subscription "$SUBSCRIPTION_ID"
   # Set any optional environment values from the old deployment here.
   azd provision --preview
   azd provision
   npm run deploy:zip
   FUNC_RG=$(azd env get-value AZURE_RESOURCE_GROUP)
   FUNC_NAME=$(azd env get-value SERVICE_API_NAME)
   az resource show --resource-type Microsoft.Web/sites \
     --name "$FUNC_NAME" --resource-group "$FUNC_RG" \
     --query "properties.{host:defaultHostName,id:customDomainVerificationId,ip:inboundIpAddress,certificates:siteScopedCertificatesEnabled}"
   curl --fail-with-body "$(azd env get-value MCP_ENDPOINT | sed 's#/mcp$##')/healthz"
   ```

   Skip replacement only if the app was already created with the flag enabled. The replacement has a new identity and storage: `azd provision` assigns its roles, but rebuild/copy the PPR index and any required cache data as described above. Update deployment automation to select the new azd environment after cutover; retain the old environment for rollback. Replacement resources incur additional costs while both environments exist.

   Before moving A/CNAME traffic, update the Function `asuid` TXT records to the **replacement's** verification ID (retain the old ID as an additional TXT value during migration). Wait for propagation, then deploy the certificate and SNI bindings using `infra/domain-tls.bicep`. This template uploads just one site-scoped private certificate and serializes the four binding updates. TXT ownership validation lets the hostnames be bound before traffic changes. If Azure reports an existing hostname binding conflict, stop and schedule removal/rebinding of that hostname; do not delete the old app to clear it.

   Run from the repository root, with Python 3 available. The password and PFX contents go into a restricted temporary parameter file, not command-line arguments:

   ```bash
   set +x
   PFX_PATH="/absolute/path/to/four-hostnames.pfx"
   TLS_PARAMS=$(mktemp)
   trap 'rm -f "$TLS_PARAMS"' EXIT
   FUNC_LOCATION=$(az resource show --resource-type Microsoft.Web/sites \
     --name "$FUNC_NAME" --resource-group "$FUNC_RG" --query location --output tsv)
   python3 - "$TLS_PARAMS" "$PFX_PATH" "$FUNC_NAME" "$FUNC_LOCATION" <<'PYTLS'
   import base64, getpass, json, pathlib, sys
   output, pfx, app, location = sys.argv[1:]
   values = {
       "functionAppName": app,
       "location": location,
       "pfxBlob": base64.b64encode(pathlib.Path(pfx).read_bytes()).decode("ascii"),
       "pfxPassword": getpass.getpass("PFX password: "),
   }
   pathlib.Path(output).write_text(json.dumps({"parameters": {
       key: {"value": value} for key, value in values.items()
   }}))
   PYTLS
   az deployment group validate --resource-group "$FUNC_RG" \
     --template-file infra/domain-tls.bicep --parameters "@$TLS_PARAMS" --output none
   az deployment group create --resource-group "$FUNC_RG" --name domain-tls \
     --template-file infra/domain-tls.bicep --parameters "@$TLS_PARAMS" --output none
   rm -f "$TLS_PARAMS"
   trap - EXIT
   ```

   Verify certificate and bindings in the portal. Only then update A/CNAME records in the table to the replacement's inbound IP/default hostname and wait for propagation. Keep the `asuid` records. Uploaded PFX certificates are **not automatically renewed**: renew through the provider, rerun this template with the new PFX under the same certificate resource name, and verify all four bindings before expiry.

4. After deploying the redirect function, check both redirects (expect 301 with the full query in `Location`) and the MCP health endpoint:

   ```bash
   curl -I 'https://mcp.irishopendata.ie/?utm_source=deployment-check'
   curl -I 'https://www.irishopendata.ie/install?utm_source=deployment-check'
   curl --fail-with-body 'https://mcp.irishopendata.ie/healthz'
   curl -I 'https://irishopendata.com/install?utm_source=deployment-check'
   curl -I 'https://www.irishopendata.com/install?utm_source=deployment-check'
   ```

Supported certificate path: [Flex limits, new-app requirement and tooling](https://learn.microsoft.com/en-us/azure/azure-functions/flex-consumption-how-to#configure-site-scoped-certificates), [creation-time opt-in and PFX resource](https://learn.microsoft.com/en-us/azure/azure-functions/functions-infrastructure-as-code#site-scoped-certificates), [SNI hostname bindings](https://learn.microsoft.com/en-us/azure/templates/microsoft.web/2024-11-01/sites/hostnamebindings). SWA validation references: [apex guide](https://learn.microsoft.com/en-us/azure/static-web-apps/apex-domain-external), [zero-downtime guide](https://learn.microsoft.com/en-us/azure/static-web-apps/custom-domain#zero-downtime-migration).

Command references: [Static Web App hostnames](https://learn.microsoft.com/en-us/cli/azure/staticwebapp/hostname), [Function App hostnames](https://learn.microsoft.com/en-us/cli/azure/functionapp/config/hostname), [ARM deployment commands](https://learn.microsoft.com/en-us/cli/azure/deployment/group).
