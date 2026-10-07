# Domain go-live runbook: irishopendata.ie

Status on 2026-10-07: **the domain is not registered yet.** The `.ie` name servers return NXDOMAIN for `irishopendata.ie`, and `irishopendata.com` is also unregistered. Everything on the Azure side is ready. Until go-live, the working URLs are:

- MCP endpoint: `https://func-ireland-mcp-aofsjpwgy4hva.azurewebsites.net/mcp`
- Site: `https://lemon-meadow-03b2b8903.3.azurestaticapps.net/`

Both keep working after go-live, so this change cannot break existing clients.

## Target layout

```text
irishopendata.ie        ALIAS → Static Web App swa-ireland-mcp   (SWA free managed cert)
www.irishopendata.ie    CNAME → Function App  → 301 to https://irishopendata.ie/<path>
mcp.irishopendata.ie    CNAME → Function App  → /mcp is the MCP endpoint; / redirects to the site
```

The Function App runs on Flex Consumption. It was created with `siteScopedCertificatesEnabled: true` (checked on 2026-10-07 with `az resource show ... --api-version 2024-11-01`), so it can use free **App Service managed certificates**. Flex allows three private certificates per app; this layout uses two (`mcp`, `www`), so no purchased or SAN certificate is needed. The `.com` aliases in `src/functions/redirect.ts` are optional. Only one of them would fit in the third certificate slot.

## Already done (Azure)

An Azure DNS zone holds every record except the SWA validation token, which can only be issued once the hostname is added. `infra/dns-zone.bicep` describes the zone, and `what-if` reports `NoChange` against it.

| Name | Type | Value |
|---|---|---|
| `@` | A (alias) | `swa-ireland-mcp` resource |
| `www` | CNAME | `func-ireland-mcp-aofsjpwgy4hva.azurewebsites.net` |
| `mcp` | CNAME | `func-ireland-mcp-aofsjpwgy4hva.azurewebsites.net` |
| `asuid.www` | TXT | Function App `customDomainVerificationId` |
| `asuid.mcp` | TXT | Function App `customDomainVerificationId` |

Name servers for the zone:

```text
ns1-01.azure-dns.com
ns2-01.azure-dns.net
ns3-01.azure-dns.org
ns4-01.azure-dns.info
```

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

Flex site-scoped certificates cannot be managed with `az functionapp config ssl`, so use the portal. Do this once for each of `mcp.irishopendata.ie` and `www.irishopendata.ie`:

1. Open the Function App `func-ireland-mcp-aofsjpwgy4hva`, then **Settings → Custom domains → Add custom domain**.
2. Domain provider: **All other domain services**. TLS/SSL certificate: **App Service Managed Certificate**. TLS/SSL type: **SNI SSL**.
3. Enter the hostname, select **Validate** (the CNAME and `asuid` TXT already exist), then **Add**. Issuance can take about 10 minutes.

Managed certificates renew automatically while the CNAME keeps pointing at the app.

## Step 4: validate

```bash
curl -sI https://irishopendata.ie/ | head -1                                   # 200
curl -sI 'https://www.irishopendata.ie/install?x=1' | grep -i -E '^(HTTP|location)'  # 301 → https://irishopendata.ie/install?x=1
curl -sI 'https://mcp.irishopendata.ie/?utm_source=check' | grep -i location   # https://irishopendata.ie/?utm_source=check
curl -s https://mcp.irishopendata.ie/healthz                                   # 200 JSON
curl -s https://mcp.irishopendata.ie/mcp -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"1"}}}' | head -c 300
echo | openssl s_client -connect mcp.irishopendata.ie:443 -servername mcp.irishopendata.ie 2>/dev/null \
  | openssl x509 -noout -subject -issuer -enddate
```

Then:

1. Point clients at `https://mcp.irishopendata.ie/mcp`: README install table, `web/AGENTS.md`, and the `.well-known` cards.
2. Add it as a second `remotes` entry in `server.json`, bump `version`, and let `publish-registry.yml` publish. Keep the `azurewebsites.net` remote listed.
3. Add the custom hostname to `MCP_ALLOWED_ORIGINS` only if browser clients on the site need it.

## Rollback

Each step can be undone on its own. The `azurewebsites.net` endpoint is never touched.

| Undo | Command |
|---|---|
| Function hostname and certificate | Portal: Function App → Custom domains → delete the binding, then Certificates → delete the managed certificate |
| SWA apex | `az staticwebapp hostname delete -n swa-ireland-mcp -g rg-ireland-mcp --hostname irishopendata.ie --yes` |
| DNS | Revert the name servers at the registrar, or `az network dns zone delete -g rg-ireland-mcp -n irishopendata.ie --yes` |

## References

- [Flex Consumption site-scoped certificates](https://learn.microsoft.com/en-us/azure/azure-functions/flex-consumption-how-to#configure-site-scoped-certificates): managed certificates are supported, there is a three-private-certificate limit, and the portal or ARM is required (not the CLI).
- [Site-scoped certificates in IaC](https://learn.microsoft.com/en-us/azure/azure-functions/functions-infrastructure-as-code#site-scoped-certificates)
- [SWA apex domain with Azure DNS](https://learn.microsoft.com/en-us/azure/static-web-apps/apex-domain-azure-dns)
- [SWA custom domains](https://learn.microsoft.com/en-us/azure/static-web-apps/custom-domain)
