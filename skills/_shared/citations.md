# Citations and attribution rules (shared by every Ireland MCP skill)

Every Ireland MCP response carries a `source` block (publisher, licence, attribution, url,
retrieved_at, and sometimes `stale`). Use it. These rules apply to every skill in this pack.

## 1. Every number carries its year and source

- Write the period the number describes **and** who published it:
  "Population 277,737 (Census 2022, CSO F1001)", not "Population 277,737".
- Live feeds: give the timestamp the tool returned, e.g. "Wind 31% of demand at 14:15 (EirGrid)".
- If the tool did not return a date, say "date not stated by source". Never invent one.

## 2. Label stale, cached or indexed data

- If a response has `stale: true` or `cached: true`, write "as of DATE" using `retrieved_at`.
- The Property Price Register is served from a periodically rebuilt index. Always write
  "PPR data as of DATE" using the newest sale date or the index date the tool reports.
- Search results (`search`) are a pointer, not evidence. Fetch the record before quoting it.

## 3. Licences and attribution lines

| Source id | Publisher | Licence | Attribution to include |
|---|---|---|---|
| `cso` | Central Statistics Office | CC BY 4.0 | Source: CSO, Ireland (www.cso.ie), CC BY 4.0 |
| `geohive` | Tailte Éireann | CC BY 4.0 | © Tailte Éireann, CC BY 4.0. Census geographies © CSO |
| `ppr` | Property Services Regulatory Authority | PSI General Licence / CC BY 4.0 | Residential Property Price Register, PSRA |
| `met-eireann` | Met Éireann | CC BY 4.0 | Copyright Met Éireann, www.met.ie, CC BY 4.0 |
| `oireachtas` | Houses of the Oireachtas | Oireachtas (Open Data) PSI Licence | Contains Oireachtas information under the Oireachtas (Open Data) PSI Licence |
| `legislation` | Office of the Attorney General (eISB) | PSI General Licence / CC BY 4.0 | Irish Statute Book data © Office of the Attorney General |
| `nta` | National Transport Authority | CC BY 4.0 | Contains NTA (Transport for Ireland) data, CC BY 4.0 |
| `irish-rail` | Iarnród Éireann | Irish Rail realtime API terms | Source: Irish Rail realtime API |
| `luas` | Transport Infrastructure Ireland | CC BY 4.0 | Source: TII Luas Forecasting API, CC BY 4.0 |
| `eirgrid` | EirGrid | Public information, attribution required | Source: EirGrid Smart Grid Dashboard |
| `marine` | Marine Institute | CC BY 4.0 | Source: Marine Institute Irish Weather Buoy Network, CC BY 4.0 |
| `opw-water` | Office of Public Works | CC BY 4.0 | Source: OPW, waterlevel.ie, CC BY 4.0 |
| `planning` | Department of Housing, Local Government and Heritage | CC BY 4.0 | Source: National Planning Application Database, CC BY 4.0 |
| `census-areas` | Tailte Éireann / OSi and CSO | CC BY 4.0 | Source: Census 2022 small areas, Tailte Éireann / CSO, CC BY 4.0 |
| `heritage` | National Monuments Service | CC BY 4.0 | Source: National Monuments Service SMR, CC BY 4.0 |
| `environment-sites` | National Parks and Wildlife Service | CC BY 4.0 | Source: NPWS Designated Areas, CC BY 4.0 |
| `data-gov-ie`, `smart-dublin` | Each dataset's publisher | Per dataset (mostly CC BY 4.0) | Name the dataset publisher and its licence field |

If the tool's `source.attribution` differs from this table, the tool wins.

## 4. Format

End every answer with a **Sources** list, one line per dataset:

```
Sources
- CSO, Census 2022 table F1001 (CC BY 4.0), retrieved 2026-10-05: <url>
- Residential Property Price Register, PSRA (PSI General Licence), data as of 2026-09-30
```

## 5. Caveats you must keep

- **No financial, legal, medical or safety advice.** Describe what the data shows. For
  decisions, point to the official body (e.g. a solicitor, a valuer, Met Éireann, the OPW, local authority).
- **PPR:** no floor area, bedroom or property-type detail beyond new vs second-hand. Prices for
  new homes **exclude VAT**. Non-market sales are excluded by default. Entries are self-declared
  and can be late or corrected.
- **Live feeds** (rail, Luas, NTA, EirGrid, OPW, buoys) can be delayed or missing. Say so if empty.
- **Weather warnings** come from Met Éireann; never downgrade or upgrade a warning level.
- **Census** figures describe the census year, not today.
