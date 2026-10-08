# Domain go-live runbook: irishopendata.com (live) and irishopendata.ie (pending)

Status on 2026-10-08:

- **`irishopendata.com` is live.** It is registered at Blacknight and delegated to the Azure DNS zone `irishopendata.com` in `rg-ireland-mcp`.
  - Docs site: `https://irishopendata.com`.
  - MCP endpoint: `https://mcp.irishopendata.com/mcp`.
- **`irishopendata.ie` is not live on Azure.** The last confirmed registrar status was `pendingCreate`, with the owner's ID document submitted; approval has not been rechecked. At 14:38 UTC on 2026-10-08, a public DNS-over-HTTPS NS lookup returned `Status: 0` and `ns1.blacknightdns.com`, `ns2.blacknightdns.com`, `ns3.blacknightdns.com`, and `ns4.blacknightdns.com`. Its Azure DNS zone is preprovisioned but not delegated, and no `.ie` Azure bindings have been created. Any `.ie` delegation or go-live requires separate explicit authorization.

The original URLs keep working and are never touched:

- `https://func-ireland-mcp-aofsjpwgy4hva.azurewebsites.net/mcp`
- `https://lemon-meadow-03b2b8903.3.azurestaticapps.net/`

## Layout

```text
irishopendata.com       ALIAS → Static Web App swa-ireland-mcp   (SWA free managed cert)        LIVE
www.irishopendata.com   CNAME → Function App → 301 to the canonical site                       LIVE
mcp.irishopendata.com   CNAME → Function App → /mcp is the MCP endpoint; / redirects to the site LIVE
irishopendata.ie        ALIAS → swa-ireland-mcp                                                 Azure records only; not bound/delegated
mcp.irishopendata.ie    CNAME → Function App                                                    Azure records only; not bound/delegated
```

The canonical site comes from the Function App setting `CANONICAL_SITE_URL`:

- It defaults to `https://irishopendata.com`.
- `src/functions/redirect.ts` accepts only the four allow-listed site origins.
- It never redirects the canonical host to itself.

## Replay-safe infrastructure (2026-10-08)

The production profile is **opt-in**: `infra/production.parameters.json` targets subscription
`0222a208-955a-45fd-b6d8-ca4704421bf0`, environment `ireland-mcp`, resource group
`rg-ireland-mcp`, region `northeurope`, and resource suffix `aofsjpwgy4hva`.
The subscription is selected on the CLI, not inferred from the parameter file.
Generic `azd` environments keep `enableProductionDomains=false` and do not adopt production DNS or domains.

```text
main.bicep
├─ service.bicep             Function, settings, storage, App Insights, existing health test
├─ production-domains.bicep  SWA + .com/.ie DNS → .com certificates → SNI bindings
└─ availability.bicep        Site GET + MCP initialize POST; alerts on all three tests
```

The domain module declares the existing `swa-ireland-mcp` in **West Europe**, preserving
its Free SKU, GitHub repository/branch and staging policy. Azure reports deployment-token
authentication; `deploymentAuthPolicy` is absent from the official 2024-11-01 writable
StaticSite schema, so no undocumented setter or deployment-token rotation is introduced.
Both DNS zones, aliases, CNAMEs and Function ownership TXT records are managed. The `.com`
apex and `_dnsauth` TXT token is `_h6b8rofq6ozlaihstd6ok0u95bkmf6z`, verified from Azure DNS.
This is public domain-verification data, not a secret. The SWA binding is `dns-txt-token`;
its certificate is issued and renewed by SWA, not a separate App Service certificate resource.

Function certificates use **`Microsoft.Web/sites/certificates@2024-11-01`**, with exact
names `mcp-irishopendata-com` and `www-irishopendata-com`. `canonicalName` requests the
managed certificate; SNI bindings read the returned thumbprint rather than pinning a
value that changes on renewal. The current two certificates expire on **2027-04-08**.
Certificates depend on DNS, and SNI bindings depend on certificates. There is no
certificate↔binding dependency cycle and no intermediate `sslState=Disabled` update.
Both certificate and binding loops deploy one resource at a time. All certificates finish
before any binding starts, avoiding App Service's shared site-update lock and HTTP 409
conflicts between concurrent hostname writes. CI runs `node --test test/infra-arm.mjs`
against the actual compiled ARM template to verify this ordering; it requires Azure CLI
and Bicep, as does deployment.

**Replay prerequisite:** the two Function hostnames already exist and are verified.
This profile is not a one-shot bootstrap of a destroyed production site. After disaster
recovery, create/verify the hostnames before managed-certificate issuance (step 3 below),
and regenerate the SWA token if the SWA/custom-domain identity was recreated. Never reuse
the old TXT token as proof that a newly created binding is valid. No bootstrap or recovery
operation is authorized by a what-if check.

`CANONICAL_SITE_URL=https://irishopendata.com` is explicitly declared. The live app had only
the eight baseline settings on inspection; the canonical URL was being supplied by the
application fallback. All eight settings remain in IaC. `additionalAppSettings` is a secure
object for any additional settings found before a later adoption/replay; managed settings
take precedence. Inspect settings before deployment, and pass new unmanaged settings
securely rather than committing credentials. An empty `mcpAllowedOrigins` preserves any
provided `MCP_ALLOWED_ORIGINS` in that object; otherwise the application's default allowlist
remains in force. The Functions host handles OPTIONS before app code, even with an empty
platform list. Every environment therefore includes the application's **concrete origins**
in platform CORS, with `supportCredentials=false`. This is not gated on production-domain
adoption: a normal azd redeploy with `enableProductionDomains=false` must not clear canonical
browser preflight while existing domain bindings remain. Only domain and monitoring resource
adoption are opt-in. The app still checks Origin on actual requests and rejects disallowed
origins; server-to-server/no-Origin requests remain supported.

The effective `MCP_ALLOWED_ORIGINS` value is parsed consistently with the app: absent/blank
means defaults, `+a,b` extends defaults, and `a,b` replaces defaults. Entries are trimmed,
lowercased and stripped of trailing slashes. The default concrete platform list is
`https://claude.ai`, `https://chatgpt.com`, `http://localhost`, `http://127.0.0.1`, the original
SWA origin, and the four `.com`/`.ie` site origins. Merely permitting `.ie` as an Origin does
not bind that domain or change DNS delegation. The Vitest infrastructure contract checks the default list
against `src/gateway/origin.ts`.

Azure's exact-origin CORS policy cannot represent app wildcard patterns such as
`vscode-webview://*`, `http://localhost:*` or one-label host wildcards. These are omitted from
the platform list rather than widened; pattern-only browser clients must supply concrete
origins through the existing `MCP_ALLOWED_ORIGINS` config (using `+` if retaining defaults).
For example, `+http://localhost:7071` preserves defaults and adds the exact local browser
origin for platform preflight; a webview client likewise needs its actual concrete origin
listed. Empty entries and entries containing `*` are excluded from the concrete platform
list. No additional platform-origin parameter or guessed local port is introduced.
Native/no-Origin clients remain supported. Only an **explicit standalone `*`** in the
effective app config produces platform `['*']`, since the app already allows every origin
in that case; production does not use it.

The live platform configuration was updated to include the old SWA and canonical origins.
After about 30 seconds, custom and default-host OPTIONS returned 204 with the expected
canonical ACAO, requested headers and method; no restart was needed. Platform-generated
preflight replies do not carry the app's custom security headers. This is an accepted
platform limitation, not a reason to add APIM or claim those headers exist on live OPTIONS.
Recheck preflight after every platform/app configuration change.

**The `.ie` zone is records-only.** This profile never binds `.ie`, issues `.ie` certificates,
changes either zone's NS records, or changes registrar delegation. Registry approval and
any `.ie` go-live need separate explicit authorization. The historical `.ie` procedure below
is not an instruction to execute it during production replay.

### Availability and recipients

Three Standard tests run every 15 minutes from Amsterdam, London and Paris:

| Probe | Success |
|---|---|
| `GET https://irishopendata.com` | 200, `Ireland MCP` content |
| `GET https://mcp.irishopendata.com/healthz` | 200, `"status":"ok"` content |
| `POST https://mcp.irishopendata.com/mcp` | 200, `"name":"ireland-mcp"` content; JSON-RPC `initialize` with protocol `2025-06-18` |

POST request bodies are base64 encoded as required by the Standard-test ARM API; headers
include JSON content type and `Accept: application/json, text/event-stream`. These tests do
not follow redirects, fetch dependent assets, or call data tools. TLS validity and seven-day
expiry checks are enabled. The existing `healthz-aofsjpwgy4hva` test remains owned by
`service.bicep` and is **retargeted** from the Azure default hostname to the custom-domain
health URL in production. Generic environments retain the default-host health URL.
`availability.bicep` creates only site and initialize tests and adds alerts for all three.
There are **three total tests, two net new**, matching the approved **€8.64/month**
incremental estimate rather than introducing a fourth test.

Each test gets a severity-1 alert for at least two failed locations over a 15-minute window.
With the email parameter supplied, the production profile creates
`ag-ireland-mcp-availability`, using the existing `budget-ireland-mcp` notification email
(verified on `actual80` and `forecast100`, read at deployment time rather than committed).
There was no Ireland MCP action group or availability alert. The unrelated
AgentOps smart-detection action group is **not** reused or changed.
`availabilityActionGroupIds` accepts explicit existing groups if one is selected later;
`availabilityAlertEmail=''` is the default and skips creating the email group. Supplying the
existing budget contact is necessary for email delivery. After an authorized deployment,
verify the alert/action-group linkage; a test notification is needed to verify delivery.
A what-if preview alone cannot prove that an email was delivered.

CAA is intentionally omitted. The Function ARM response names GeoTrust TLS RSA CA G1,
but that alone does not establish every CAA issuer SWA and Flex renewal need. Do not add a
restrictive CAA record until official requirements for **both** platforms are verified.

### Validate before any deployment

These commands do not deploy resources:

```bash
npm test -- test/infrastructure.test.ts
az bicep build --file infra/main.bicep --stdout >/dev/null
export AVAILABILITY_CONTACT_EMAIL="$(az consumption budget show \
  --subscription 0222a208-955a-45fd-b6d8-ca4704421bf0 \
  --resource-group rg-ireland-mcp \
  --budget-name budget-ireland-mcp \
  --query 'notifications.actual80.contactEmails[0]' -o tsv)"
: "${AVAILABILITY_CONTACT_EMAIL:?Existing budget contact not returned}"
az deployment sub what-if \
  --subscription 0222a208-955a-45fd-b6d8-ca4704421bf0 \
  --location northeurope --name ireland-mcp-domain-hardening-preview \
  --template-file infra/main.bicep --parameters @infra/production.parameters.json \
    availabilityAlertEmail="$AVAILABILITY_CONTACT_EMAIL"
```

For a focused domain replay preview without unresolved Function-output expressions:

```bash
az deployment group what-if \
  --subscription 0222a208-955a-45fd-b6d8-ca4704421bf0 \
  --resource-group rg-ireland-mcp \
  --template-file infra/production-domains.bicep \
  --parameters \
    functionAppName=func-ireland-mcp-aofsjpwgy4hva \
    functionDefaultHost=func-ireland-mcp-aofsjpwgy4hva.azurewebsites.net \
    functionVerificationId=3DFC22AB3CDA2A0D651205D528769953BA3DE464D8F1EFF9A920C2A53C2B5F6A \
    staticWebAppValidationToken=_h6b8rofq6ozlaihstd6ok0u95bkmf6z \
    location=northeurope
```

Only after deployment approval, use the **same** subscription, template and production
parameter file and email parameter with `az deployment sub create`. Do not run the generic parameter profile
against production and assume it enables production resources. With azd, configure the
existing `ireland-mcp` environment first:

```bash
azd env set AZURE_SUBSCRIPTION_ID 0222a208-955a-45fd-b6d8-ca4704421bf0
azd env set AZURE_LOCATION northeurope
azd env set AZURE_RESOURCE_NAME_SUFFIX aofsjpwgy4hva
azd env set ENABLE_PRODUCTION_DOMAINS true
azd env set SWA_DOMAIN_VALIDATION_TOKEN _h6b8rofq6ozlaihstd6ok0u95bkmf6z
azd env set CANONICAL_SITE_URL https://irishopendata.com
azd env set AVAILABILITY_CONTACT_EMAIL "$AVAILABILITY_CONTACT_EMAIL"
```

Do not execute `azd provision`/`azd up` without separate deployment approval. What-if is a
preview, not a successful no-op deployment: new monitoring resources and canonical/CORS
settings are intentional changes, and provider-generated certificate metadata/unresolved
references can appear as modifications. Inspect the live `/config/web` and app settings
separately because site what-if does not reliably display those settings.
The production JSON profile leaves the budget module disabled and therefore does not
change the existing **20** monthly amount, **2026-10-01** start or notification rules;
it also pins those values if budget management is explicitly enabled later.
Do not pass `budgetContactEmail` just to configure availability; use the separate email
parameter above. For this azd domain replay, leave `BUDGET_CONTACT_EMAIL` unset so the
existing budget is untouched. If changing the budget is separately authorized, use the
production parameter profile and original start date rather than a new month's `utcNow`.

### Pre-deployment validation evidence

Read-only Azure inspection on 2026-10-08 confirmed the exact production identities,
`siteScopedCertificatesEnabled=true`, both `.com` SNI bindings, the two managed certificates,
SWA `.com` status `Ready`, both zones' existing records, eight Function settings and the
existing budget email. Standard probes were exercised against the custom hostnames:
site content, GET health and POST initialize all succeeded. Local DNS filtered the newly
registered MCP hostname; public DNS-over-HTTPS returned its CNAME/A chain, and `curl --resolve`
verified the real HTTPS host without bypassing certificate checks. Canonical OPTIONS also
returned 204 with ACAO after the platform CORS update.

The corrected full subscription preview succeeded with **6 Create, 22 Modify, 14 NoChange,
0 Delete**. Creates are two Standard tests, three metric alerts and the email action group.
The original health-test identity is modified in place from
`https://func-ireland-mcp-aofsjpwgy4hva.azurewebsites.net/healthz` to
`https://mcp.irishopendata.com/healthz`, not created or disabled.
Existing core-resource modifications include unresolved ARM reference expressions,
provider-default storage/App Insights properties and site configuration. Canonical app
settings are intentional but are not rendered reliably by site what-if.

The focused domain preview succeeded with **16 NoChange, 4 Modify, 6 Ignore, 0 Create,
0 Delete**: all DNS records and both SNI bindings were `NoChange`; the modifications were
the two certificates' provider-generated metadata, SWA-generated metadata and the SWA
validation-method request. `Ignore` covers existing resources outside the focused template.
These previews are not a proven no-op deployment. Rerun the commands above against the
current source before deployment, then verify certificate replay and browser/redirect
behavior live. Check notification delivery separately if a test notification is authorized.

Bicep 0.38.33 compiles the template, but its older type catalog reports BCP037 for
`siteScopedCertificatesEnabled`, which is verified in official Functions IaC documentation
and in live ARM. No Bicep upgrade was performed. Domain bootstrap after destructive loss,
CAA issuer policy and future `.ie` approval remain deliberately separate constraints.

### Slot limits

| Resource | Limit | Used now | After the `.ie` switch |
|---|---|---|---|
| Function App (Flex site-scoped private certs) | 3 | `mcp.com`, `www.com` | Add `mcp.ie` (3 of 3). `www.ie` would need a 4th slot, so either skip it or replace `www.com`. |
| SWA Free custom domains | 2 | apex `.com` | apex `.ie` (2 of 2). The Standard plan (about $9/month) raises the limit if more are ever needed. |

## Azure DNS zones

Both zones come from `infra/dns-zone.bicep` with a different `zoneName`.

| Name | Type | Value |
|---|---|---|
| `@` | A (alias) | `swa-ireland-mcp` resource |
| `@`, `_dnsauth` | TXT | SWA validation token (added in step 2) |
| `www` | CNAME | `func-ireland-mcp-aofsjpwgy4hva.azurewebsites.net` |
| `mcp` | CNAME | `func-ireland-mcp-aofsjpwgy4hva.azurewebsites.net` |
| `asuid.www` | TXT | Function App `customDomainVerificationId` |
| `asuid.mcp` | TXT | Function App `customDomainVerificationId` |

Name servers. Each zone has its own set, so check them with `az network dns zone show -g rg-ireland-mcp -n <zone> --query nameServers`.

```text
irishopendata.com: ns1-02.azure-dns.com ns2-02.azure-dns.net ns3-02.azure-dns.org ns4-02.azure-dns.info
irishopendata.ie:  ns1-01.azure-dns.com ns2-01.azure-dns.net ns3-01.azure-dns.org ns4-01.azure-dns.info
```

Some local resolvers block newly registered domains for a few days. When `dig` on your machine returns nothing, check with DNS-over-HTTPS: `curl -s 'https://dns.google/resolve?name=mcp.irishopendata.com&type=CNAME'`.

## Finishing irishopendata.ie (after the .IE registry approves the ID document)

1. **Delegate.** At Blacknight, open My Domains → `irishopendata.ie` → Nameservers. Choose "Use custom nameservers" and enter the four `-01` name servers above. This is the same flow used for `.com`.
2. **Bind the apex** with step 2 below, using `ZONE=irishopendata.ie`.
3. **Bind `mcp.irishopendata.ie`** with step 3 below. This uses the third and last certificate slot.
4. **Make `.ie` canonical:**
   1. Run `az functionapp config appsettings set -g rg-ireland-mcp -n func-ireland-mcp-aofsjpwgy4hva --settings CANONICAL_SITE_URL=https://irishopendata.ie`.
   2. Update the site and docs URLs to `.ie`.
   3. Add `https://mcp.irishopendata.ie/mcp` as a further `server.json` remote, bump the version and tag it.

   After this, `irishopendata.com` itself stays on the SWA and serves the same site. Add `<link rel="canonical">` pointing at `.ie` so search engines pick one domain.
5. **Validate** with step 4 below, using the `.ie` hostnames.

## Step 1: register and delegate (owner, at the registrar)

This step needs a payment and a registrar login, so the owner does it.

1. Register `irishopendata.ie` with any `.ie` accredited registrar. `.ie` requires a connection to Ireland, such as an Irish address.
2. Set the domain's name servers to the four Azure name servers above. Do not add records at the registrar; the Azure zone is authoritative.

Check the delegation. It usually takes minutes, but can take up to 48 hours:

```bash
dig +short NS irishopendata.ie @a.ns.ie        # expect the four azure-dns names
dig +short CNAME mcp.irishopendata.ie @8.8.8.8 # expect func-ireland-mcp-...azurewebsites.net
dig +short TXT asuid.mcp.irishopendata.ie @8.8.8.8
```

## Step 2: bind the apex to the Static Web App

```bash
RG=rg-ireland-mcp; SWA=swa-ireland-mcp; ZONE=irishopendata.ie
az staticwebapp hostname set -n "$SWA" -g "$RG" --hostname "$ZONE" \
  --validation-method dns-txt-token --no-wait
sleep 30
TOKEN=$(az staticwebapp hostname show -n "$SWA" -g "$RG" --hostname "$ZONE" --query validationToken -o tsv)
# Microsoft's guides disagree on the TXT name (apex vs _dnsauth). Publishing both is harmless.
az network dns record-set txt add-record -g "$RG" -z "$ZONE" -n @ -v "$TOKEN"
az network dns record-set txt add-record -g "$RG" -z "$ZONE" -n _dnsauth -v "$TOKEN"
az staticwebapp hostname show -n "$SWA" -g "$RG" --hostname "$ZONE" --query status -o tsv  # wait for Ready
```

Alternative: in the portal, open the Static Web App, then **Custom domains → + Add → Custom domain on Azure DNS**, and pick the zone. The portal creates the TXT and alias records itself.

## Step 3: bind `mcp` and `www` to the Function App with managed certificates

Flex site-scoped certificates cannot be managed with `az functionapp config ssl`. Use the ARM REST API, which is what was used for `.com` on 2026-10-08, or the portal.

```bash
APP=/subscriptions/$(az account show --query id -o tsv)/resourceGroups/rg-ireland-mcp/providers/Microsoft.Web/sites/func-ireland-mcp-aofsjpwgy4hva
H=mcp.irishopendata.com; C=${H//./-}; V=api-version=2024-11-01
# 1. hostname binding (needs the CNAME and asuid TXT)
az rest --method put --url "https://management.azure.com$APP/hostNameBindings/$H?$V" \
  --body '{"properties":{"hostNameType":"Verified","customHostNameDnsRecordType":"CName","sslState":"Disabled"}}'
# 2. free managed certificate: 202 Accepted, issued in about 1-5 minutes
az rest --method put --url "https://management.azure.com$APP/certificates/$C?$V" \
  --body "{\"location\":\"North Europe\",\"properties\":{\"canonicalName\":\"$H\"}}"
TP=$(az rest --method get --url "https://management.azure.com$APP/certificates/$C?$V" --query properties.thumbprint -o tsv)
# 3. SNI binding
az rest --method put --url "https://management.azure.com$APP/hostNameBindings/$H?$V" \
  --body "{\"properties\":{\"hostNameType\":\"Verified\",\"customHostNameDnsRecordType\":\"CName\",\"sslState\":\"SniEnabled\",\"thumbprint\":\"$TP\"}}"
```

Portal alternative, for each hostname:

1. Open the Function App `func-ireland-mcp-aofsjpwgy4hva`, then **Settings → Custom domains → Add custom domain**.
2. Domain provider: **All other domain services**. TLS/SSL certificate: **App Service Managed Certificate**. TLS/SSL type: **SNI SSL**.
3. Enter the hostname, select **Validate** (the CNAME and `asuid` TXT already exist), then **Add**. Issuance can take about 10 minutes.

Managed certificates renew automatically while the CNAME keeps pointing at the app.

## Step 4: validate

```bash
D=irishopendata.com   # or irishopendata.ie
curl -sI "https://$D/" | head -1                                   # 200
curl -sI "https://www.$D/install?x=1" | grep -i -E '^(HTTP|location)'  # 301 → https://$D/install?x=1
curl -sI "https://mcp.$D/?utm_source=check" | grep -i location   # https://$D/?utm_source=check
curl -s https://mcp.$D/healthz                                   # 200 JSON
curl -s https://mcp.$D/mcp -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"1"}}}' | head -c 300
echo | openssl s_client -connect mcp.$D:443 -servername mcp.$D 2>/dev/null \
  | openssl x509 -noout -subject -issuer -enddate
```

Then:

1. Point clients at `https://mcp.$D/mcp`: the README install table, `web/AGENTS.md`, `web/llms.txt` and the `.well-known` cards. This was done for `.com` in v1.1.3.
2. Add it as a `remotes` entry in `server.json`, bump `version`, and push a `v*` tag so `publish-registry.yml` publishes it. Keep the `azurewebsites.net` remote listed.
3. `src/gateway/origin.ts` already allows the `.com` and `.ie` site origins.

## Rollback

Each step can be undone on its own. The `azurewebsites.net` endpoint is never touched.

| Undo | Command |
|---|---|
| Function hostname and certificate | Portal: Function App → Custom domains → delete the binding, then Certificates → delete the managed certificate |
| Function hostname and certificate (REST) | `az rest --method delete --url ".../hostNameBindings/<host>?api-version=2024-11-01"`, then the same for `.../certificates/<host-with-dashes>` |
| SWA apex | `az staticwebapp hostname delete -n swa-ireland-mcp -g rg-ireland-mcp --hostname <apex> --yes` |
| DNS | Blacknight → My Domains → the domain → Nameservers → **Use default nameservers**, or `az network dns zone delete -g rg-ireland-mcp -n <zone> --yes` |
| Canonical site | `az functionapp config appsettings delete -g rg-ireland-mcp -n func-ireland-mcp-aofsjpwgy4hva --setting-names CANONICAL_SITE_URL` (falls back to `.com`) |

## References

- [Flex Consumption site-scoped certificates](https://learn.microsoft.com/en-us/azure/azure-functions/flex-consumption-how-to#configure-site-scoped-certificates): managed certificates are supported, there is a three-private-certificate limit, and the portal or ARM is required (not the CLI).
- [Site-scoped certificates in IaC](https://learn.microsoft.com/en-us/azure/azure-functions/functions-infrastructure-as-code#site-scoped-certificates)
- [SWA apex domain with Azure DNS](https://learn.microsoft.com/en-us/azure/static-web-apps/apex-domain-azure-dns)
- [SWA custom domains](https://learn.microsoft.com/en-us/azure/static-web-apps/custom-domain)
- [Site-scoped certificate ARM schema](https://learn.microsoft.com/en-us/azure/templates/microsoft.web/2024-11-01/sites/certificates): `canonicalName` requests a free certificate on the Function site.
- [Standard availability test ARM schema](https://learn.microsoft.com/en-us/azure/templates/microsoft.insights/2022-06-15/webtests): POST bodies are base64 encoded.
- [Functions host CORS policy](https://github.com/Azure/azure-functions-host/blob/dev/src/WebJobs.Script.WebHost/Configuration/CorsOptionsSetup.cs) and [host CORS options](https://github.com/Azure/azure-functions-host/blob/dev/src/WebJobs.Script.WebHost/Configuration/HostCorsOptionsSetup.cs): exact origins, any method/header, credentials off by default.
