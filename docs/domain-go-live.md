# Domain go-live runbook: irishopendata.com (live) and irishopendata.ie (pending)

Status on 2026-10-08:

- **`irishopendata.com` is live.** It is registered at Blacknight and delegated to the Azure DNS zone `irishopendata.com` in `rg-ireland-mcp`.
  - Docs site: `https://irishopendata.com`.
  - MCP endpoint: `https://mcp.irishopendata.com/mcp`.
- **`irishopendata.ie` is registered but `pendingCreate`.** The .IE registry is waiting for the owner's ID document. Its Azure DNS zone already exists.

The original URLs keep working and are never touched:

- `https://func-ireland-mcp-aofsjpwgy4hva.azurewebsites.net/mcp`
- `https://lemon-meadow-03b2b8903.3.azurestaticapps.net/`

## Layout

```text
irishopendata.com       ALIAS → Static Web App swa-ireland-mcp   (SWA free managed cert)        LIVE
www.irishopendata.com   CNAME → Function App → 301 to the canonical site                       LIVE
mcp.irishopendata.com   CNAME → Function App → /mcp is the MCP endpoint; / redirects to the site LIVE
irishopendata.ie        ALIAS → swa-ireland-mcp                                                 pending .IE registration
mcp.irishopendata.ie    CNAME → Function App                                                    pending .IE registration
```

The canonical site comes from the Function App setting `CANONICAL_SITE_URL`:

- It defaults to `https://irishopendata.com`.
- `src/functions/redirect.ts` accepts only the four allow-listed site origins.
- It never redirects the canonical host to itself.

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

Registration needs a payment and a registrar login, so the owner does it. Changing the name servers in an already-logged-in control panel is a reversible DNS change.

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
