# Public source additions and access

Implemented on 13 October 2026. These adapters use the existing evidence envelope,
bounded HTTP client and cache. The compact MCP surface still has seven tools.
Use `ireland_catalogue`, `ireland_describe`, then `ireland_call`.

| Source | Operation | Access | Data limits |
| --- | --- | --- | --- |
| `failte-ireland` | `failte_search` | Keyless official accommodation and attractions CSVs | Listed businesses only. No availability or opening hours. Source update time is unknown. |
| `tfi-static` | `tfi_static_search_stops` | Keyless official NaPTAN JSON | Static stop records, including cross-border records. AtcoCode is not a verified GTFS stop ID. No route planner or live-service claim. |
| `gsi` | `groundwater_vulnerability_at` | Public GSI ArcGIS point query | Map scale 1:40000; revision unknown. Screening only. Partial transfers cannot prove no coverage. |
| `logainm` | `logainm_search_places` | Gaois account and server-side `LOGAINM_API_KEY` | Bilingual names and coordinate accuracy. Live access remains unverified until a key is configured. |

Examples:

```json
{"source":"failte-ireland","operation":"failte_search","args":{"dataset":"attractions","county":"Galway","limit":5}}
{"source":"tfi-static","operation":"tfi_static_search_stops","args":{"name":"Heuston","limit":5}}
{"source":"gsi","operation":"groundwater_vulnerability_at","args":{"lat":53.3498,"lon":-6.2603,"limit":5}}
{"source":"logainm","operation":"logainm_search_places","args":{"query":"Gaillimh","limit":5}}
```

## Verification and cache rules

Offline tests cover argument rejection, publisher-shaped responses, empty searches,
malformed national feeds, upstream failure, missing coordinates, transfer limits,
pagination and cache behavior. Fáilte preserves an SHA-256 digest of the original
CSV bytes and the download time. TFI preserves the original snapshot timestamp
without inventing a timezone. Unknown source dates remain `null`.

Bounded real local upstream checks passed for both Fáilte exports, the NaPTAN
download and a GSI point query. At the check, Fáilte returned 2,296 accommodation
records and 6,250 attractions. The NaPTAN snapshot was dated 8 October 2026.
These are dated observations, not completeness or hosted-availability guarantees.
The published counts keep the new sources in `HOSTED_LIMITS` until their hosted
operations are verified. Health probes check HTTP liveness, not dataset accuracy.

Fáilte imports are limited to 5 MiB and 10,000 records and cached for one hour.
NaPTAN is limited to 30 MiB and 100,000 stops and cached for one day. Its observed
download is about 21.7 MB; only compact normalized records enter the cache.
GSI uses a 10-second timeout, one-day cache and at most 10 point matches.
Logainm uses a bounded single page, 4 MiB response bound and one-day cache.
No invalid national feed is stored as a valid empty result.

## Operator keys

The hosted public connector needs no visitor account or key. These keys belong to
the server operator:

1. [NTA developer portal](https://developer.nationaltransport.ie/): the existing
   realtime adapter needs `NTA_API_KEY`. Static stop discovery works without it.
2. [Gaois registration](https://docs.gaois.ie/en/data/getting-started): register an
   operator account, then obtain a Logainm key. Store it as `LOGAINM_API_KEY` in the
   existing secret manager. The adapter sends `X-Api-Key`, not a URL credential.

Do not place keys in the repository, public examples, browser code, logs or PR
comments. For hosted configuration, use the existing Key Vault method and a secret
reference through `additionalAppSettings`. Missing Logainm configuration returns
`NOT_CONFIGURED` before any HTTP request. After configuration, verify an actual
hosted operation before removing its hosted limitation.

## Licence and source links

- [Fáilte open data](https://www.failteireland.ie/en/info/open-data) and official
  [accommodation](https://failteireland.azure-api.net/opendata-api/v2/accommodation/csv)
  and [attractions](https://failteireland.azure-api.net/opendata-api/v2/attractions/csv)
  exports: CC BY 4.0, Fáilte Ireland attribution.
- [TFI public transport data](https://www.transportforireland.ie/transitData/PT_Data.html):
  CC BY 4.0, NTA/TFI attribution.
- [GSI groundwater catalogue](https://data.gov.ie/dataset/groundwater-vulnerability-140000-ireland-roi-itm):
  CC BY 4.0. Preserve the exact GSI attribution returned by the tool.
- [Logainm API](https://docs.gaois.ie/en/data/logainm/v1.0/api),
  [schema](https://docs.gaois.ie/en/data/logainm/v1.0/data) and
  [licence](https://docs.gaois.ie/en/data/logainm/v1.0/licence): CC BY 4.0.

## Sources that still need a reuse decision

SEAI BER and NTPF are not imported by this change. [BER terms](https://ndber.seai.ie/berresearchtool/TnC.pdf)
describe personal, research and education use. Confirm public MCP reuse before
import. [NTPF terms](https://www.ntpf.ie/information-re-use/) restrict use principally
to advertise or promote a product or service. Resolve that intended use before
public exposure; preserve suppressed groups in any later import.

No paid scraping service is required for the implemented official exports.
