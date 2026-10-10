# Ranked dataset and app opportunities

Checked on **10 October 2026**. This is a research record. It distinguishes current source support from proposed additions. The source registry has 29 providers. No new provider account, paid service, connector, or app was created for this review.

| Rank | User task | Data route | Current status | Next bounded change |
| --- | --- | --- | --- | --- |
| 1 | Compare historical apartment rents between places | RTB quarterly table `RIQ02`, through the existing CSO API | Real local and hosted MCP queries passed; curated site example implemented | Extend the comparison with clear period/property labels; keep the existing CSO connector |
| 2 | Check groundwater constraints near a site | GSI groundwater vulnerability polygons, public ArcGIS REST | Direct point read passed once; a later read timed out; no GSI connector | Add one bounded point lookup with source date, map scale, cache and explicit failure |
| 3 | Compare public hospital waiting-list trends | NTPF public CSV downloads | Direct CSV read passed; reuse suitability remains open; no connector or supported API established | Check the intended product use against provider terms before import or public MCP exposure |

## 1. RTB rents: use the existing CSO connector

The [RTB dataset page](https://rtb.ie/data-insights/rtb-data-hub/rtb-esri-rent-index-data-set/) links its quarterly average-rent report to [CSO table RIQ02](https://data.cso.ie/table/RIQ02). It covers locations, bedrooms, property types and quarters. A `0.00` result means insufficient data. It must not be displayed as a zero rent. The [official catalogue resource](https://data.gov.ie/dataset/riq02-rtb-average-monthly-rent-report/resource/2d0031b4-3a1e-4921-985f-1d507d335f98) states CC BY 4.0.

**Live read proof:** the MCP SDK client used an in-memory transport to call the current built server's `ireland_call`, with real public CSO upstream requests and no credentials. At `2026-10-10T17:22:56.431Z`, it returned one row: **Galway City, Two bed, Apartment, 2025Q4, €1,672.57**. `cached` and `truncated` were both false. This proves the local MCP route and upstream read. It does not prove hosted deployment or frontend rendering.

```json
{
  "source": "cso",
  "operation": "cso_get_data",
  "args": {
    "table_code": "RIQ02",
    "filters": {
      "STATISTIC": ["RIQ02"],
      "TLIST(Q1)": ["20254"],
      "C02970V03592": ["02"],
      "C02969V03591": ["04"],
      "C03004V03625": ["141600"]
    },
    "limit": 5
  }
}
```

Use the title **“Galway City two-bed apartment rents · Q4 2025”**. State that the result is a historical quarterly RTB registered-tenancy average. It is not a live asking-rent feed or a measure of the entire rental market. `141600` is Galway City; `140200` is Galway county.

The [public metadata endpoint](https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadMetadata/RIQ02/en) reported an update of `2026-05-14T11:00:00Z` and a latest quarter of `2025Q4` during this review. Show both the data period and retrieval time. Do not use the retrieval time as the rent period. The metadata names RTB as the data owner; preserve RTB provenance as well as the existing CSO attribution.

The curated frontend example uses this table. A hosted MCP SDK query also returned the same row at `2026-10-10T17:27:44.990Z`, with `cached: false` and `truncated: false`. This proves the public server route; live interface acceptance is a separate release check. A comparison flow can follow without a new backend dependency: query the same quarter, property type and bedroom count for each location, and show missing or suppressed data explicitly.

## 2. GSI groundwater vulnerability: new coverage, public API

The current `environment-sites` source covers NPWS designated sites. It does not provide groundwater vulnerability. The [GSI dataset catalogue](https://data.gov.ie/dataset/groundwater-vulnerability-140000-ireland-roi-itm) provides polygon data at 1:40,000 scale in Irish Transverse Mercator, under CC BY 4.0. Its required attribution is: “Contains Irish Public Sector Data (Geological Survey Ireland) licensed under a Creative Commons Attribution 4.0 International (CC BY 4.0) licence”. The catalogue lists annual updates but a dataset update date of 22 October 2021. A newer catalogue modification date does not prove newer mapping.

The [official ArcGIS service](https://gsi.geodata.gov.ie/server/rest/services/Groundwater/IE_GSI_Groundwater_Vulnerability_40K_IE26_ITM/MapServer) advertises query support, JSON/GeoJSON output and a maximum of 2,000 records. Layer `0` exposes `VUL40KID`, `VUL_CAT` and `VUL_DESC`. No account was required for the successful direct read. A documented service quota or availability guarantee was not established.

**Read proof:** a WGS84 point query at longitude `-8.9`, latitude `53.4`, with `inSR=4326`, `spatialRel=esriSpatialRelIntersects`, the three fields above, no geometry output and a 10-record limit returned HTTP 200 and one polygon: `IE_GSI_Vul_40K_28747`, category `E`, description `Extreme`. A later attempt to save the same public query timed out while reading the HTTP response at 20 seconds. Treat service reliability as unproved.

Add only a point lookup first. Return the category, feature ID, source URL, map scale, known revision date and retrieval time. Respect `exceededTransferLimit`; an incomplete response cannot prove that no polygon exists. Use a bounded timeout and explicit stale-cache or upstream-error state. Test polygon edges, unsupported points, transfer limits and failures before adding map tiles or bulk downloads.

This can extend a site brief that already combines planning applications, protected sites, monuments and nearby OPW river readings. Groundwater vulnerability describes susceptibility to pollution. It does not establish current water quality, flood risk or site engineering approval. Check each GSI dataset's licence separately before extending coverage: some groundwater flooding products have different terms.

## 3. NTPF waiting lists: public CSV, no API claim

The [NTPF open-data page](https://www.ntpf.ie/waiting-list-data/open-data/) publishes aggregate outpatient, inpatient and day-case files. Reports are monthly. These are downloadable CSV files; this review did not establish a supported query API. No account was required for the tested download.

**Live read proof:** at `2026-10-10T17:24:13Z`, [the outpatient hospital CSV](https://www.ntpf.ie/app/uploads/2026/10/OpenData_OPNational01_2026.csv) returned HTTP 200 and 52,321 bytes. A CSV parser read 704 rows and nine reporting dates. The latest was **24 September 2026**, although the URL has an October upload directory. The columns are `ArchiveDate`, `Adult_Child`, `HospitalName`, four waiting-time bands and `Total`. Quoted numeric values can contain commas.

The [NTPF reuse policy](https://www.ntpf.ie/information-re-use/) allows free reuse with source and copyright acknowledgement, accurate presentation and limits on misleading use. It prohibits use principally to advertise or promote a product or service. These are provider terms; do not relabel them as CC BY. Preserve suppression and aggregation rules, including “Small Volume” groups, when importing other NTPF files. These counts cannot predict an individual's treatment date.

First check whether the intended app and public MCP exposure comply with the provider's restriction on advertising or promotion. Public download access alone does not resolve reuse suitability. If the intended use remains unclear, obtain clarification from NTPF before import or public exposure. This candidate has an additional reuse gate that the tested CSO and GSI datasets do not have.

After that check, start with one versioned outpatient hospital CSV import. Discover the current link from the official index, rather than constructing a monthly URL. Record the file URL, retrieval time, checksum and reporting dates. Validate numeric parsing, adult/child categories, row totals and duplicate date/hospital keys. Show a monthly count trend with waiting-time bands; do not infer patient movements or treatment activity from changes in totals.

## Useful apps through current sources

These are proposed product flows. They are not implemented apps or evidence of complete route planning.

| App concept | Existing sources to reuse | Honest initial scope |
| --- | --- | --- |
| Area brief | GeoHive, CSO area profile, census small areas, planning, heritage, protected sites, Met Éireann | A cited place summary with separate census, planning and forecast dates; optional GSI point lookup later |
| Commute check | Irish Rail station/departure tools, Luas stop/forecast tools, bikes, configured NTA feed | Check known stops and departures. A door-to-door itinerary requires routing and schedule support beyond the current tools |
| Housing comparison | RTB through CSO, PPR, GeoHive, census and planning | Compare dated rent averages and recorded sale statistics separately; preserve place boundaries, period and sample limits |

Use these flows to test useful outcomes before adding another backend service. Keep each result's source, licence, data period, retrieval time, cache state and missing-data state visible.
