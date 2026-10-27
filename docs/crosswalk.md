# Place crosswalk

Every Irish data source names places in its own way. The CSO uses councils and local electoral
areas (LEAs), the Department of Social Protection writes "Co.Donegal", Pobal uses electoral division
(ED) ids, Kohesio uses NUTS3 codes, and the Oireachtas uses Dáil constituencies. To join two of them,
an agent needs to know how these areas fit together.

`ireland_resolve_place` answers that from one offline table. Give it a place and it returns every
code and name for that place, at every level. For areas that cross a boundary, it gives the share of
residents on each side.

## What it covers

| Level | Count | Codes and names | Source |
| --- | ---: | --- | --- |
| Province | 4 | English and Irish name | By statute, from the county |
| County | 26 | English and Irish name | By statute, from the local authority |
| Local authority (council) | 31 | English and Irish name | CSO Census 2022 small areas; Local Government Reform Act 2014 |
| NUTS3 region | 8 | Code (e.g. IE042) and name; NUTS2 parent | CSO Census 2022 small areas |
| Dáil constituency | 43 | Name, Irish name, seats, Tailte Éireann boundary id | Tailte Éireann 2023 boundaries (used from the 2024 general election) |
| Local electoral area (LEA) | 166 | Name, Irish name, seats, Tailte Éireann boundary id, council | CSO Census 2022 small areas, checked against Tailte Éireann 2024 boundaries |
| Electoral division (ED) | 3,417 | 6-digit id (as used by Pobal and the CSO), English and Irish name, Census 2022 population | CSO Census 2022 small areas and SAPS table T1_1 |
| Small area | 18,919 | 9-digit code and GEOGID, for a point or a small-area code | Live query of the CSO Census 2022 small-area layer |

**Not covered.** No open boundary file was found for these, so they are not in the table:

- Garda divisions;
- HSE community healthcare organisations and health regions;
- Eircode routing-key areas. Their boundaries are licensed, not open.

The tool says so in its `not_covered` field.

## What you can ask

| Input | Example | What happens |
| --- | --- | --- |
| A county, council, LEA, constituency, NUTS3 region, province or ED name | `Galway City Council`, `Galway West (5)`, `Gaillimh`, `Munster` | Looked up offline. English and Irish names both work, with or without the fada. Prefixes like "Co." and suffixes like seat counts are ignored. |
| A CSO label in "area, council" form | `Athenry-Oranmore, Galway County`, `Athlone, Roscommon` | The council or county picks out the right area. There are two Athlone LEAs, one in Westmeath and one in Roscommon. |
| A code | `068001` (ED), `IE042` (NUTS3), `268098009` (small area) | The ED and NUTS3 lookups are offline; a small-area code takes one live query. Pobal's 5-digit ED ids such as `68001` also work. |
| A Dublin postal district | `Dublin 8`, `D6W` | Maps to the EDs whose names belong to the district. Flagged `approximate`. |
| A point | `lat`, `lon` | One live CSO query finds the small area. The rest comes from the offline table. |
| A town, village or neighbourhood | `Ballybane, Galway`, `Tallaght` | Uses the Tailte Éireann gazetteer point. Flagged `approximate`, because a town can span several EDs. |

Add `list` to get the areas inside a place. Each row carries its population and the share of its
residents inside the place. Some examples:

- the EDs of a council, with each ED's LEA and constituency: `{ "place": "Galway City Council", "list": "ed" }`;
- the councils in a province: `{ "place": "Munster", "list": "local_authority" }`;
- the counties in a NUTS3 region: `{ "place": "IE042", "list": "county" }`;
- the LEAs in a constituency: `{ "place": "Dublin Bay North", "list": "lea" }`.

A `list` result is a table handle. [`ireland_query`](query.md) can join it to other sources on
the server, for example the EDs of a council to Pobal scores by `ed_id`, then roll them up to LEAs.

`nearby` and `ireland_snapshot` also return a short `codes` block from the same table: ED, LEA,
constituency, council, county and NUTS3.

## How the table is built

`scripts/build-crosswalk.mjs` builds `web/data/crosswalk/places-2022.json` (about 280 KB). The site
publishes it at `https://irishopendata.ie/data/crosswalk/places-2022.json`, and the server reads the
same file. The build works in four steps:

1. Every Census 2022 small area carries CSO's own ED, administrative county, LEA and NUTS3 codes.
   No overlay is needed for these levels.
2. Each small area's population comes from the CSO Census 2022 SAPS table T1_1. The ED populations
   add up to 5,149,139, the Census 2022 total.
3. The build takes a point inside each small area and tests it against the 2023 constituency
   boundaries and the 2024 statutory LEA boundaries. An ED's constituency shares are the population
   shares of its small areas. Nine small areas just off the coast took the nearest boundary within 2 km.
4. The 34 administrative counties used in the census map to today's 31 councils under the Local
   Government Reform Act 2014. Councils then map to counties and provinces by statute.

The file records:

- its as-of date;
- each source's URL, licence, retrieval time and feature count;
- a SHA-256 of each source's attribute rows;
- quality counters.

The tool reports the file's own SHA-256.

The build stops if any of these checks fail:

- every small area gets a constituency and an LEA;
- the CSO and Tailte Éireann LEAs match one to one by name;
- there are 43 constituencies with 174 seats;
- there are 166 LEAs with 949 seats;
- there are 31 councils.

To rebuild it:

```bash
node scripts/build-crosswalk.mjs --as-of YYYY-MM-DD
npm test
```

## Known limits

- **LEA follows CSO's coding.** CSO assigns an LEA to each small area, and the CSO's LEA tables
  (such as NDA05) use the same coding. For 161 of the 18,919 small areas (0.85%), the point falls in
  a different statutory LEA. Most are in fast-growing parts of Dublin, such as Lucan and
  Glencullen-Sandyford. The file lists them under `quality.lea_disagreements`.
- **An ED can straddle a boundary.** Three EDs straddle two LEAs, and Phoenix Park straddles two
  constituencies. They appear with population shares.
- **Constituency shares are small-area precise.** A boundary that splits a small area is assigned
  whole to one side.
- **RTB rents are not available by LEA.** CSO's RTB tables (RIA02, RIQ02) report rents by county,
  town and neighbourhood ("Ballybane, Galway"). The crosswalk can place a neighbourhood's gazetteer
  point in an LEA, but you cannot average neighbourhood rents into an LEA rent without tenancy counts.
  RTB publishes LEA rents only in its own Rent Index reports, which are not yet in the catalogue.
- **Postal districts are approximate.** Dublin postal districts are delivery areas, so the ED list is
  a guide.
- **The vintages differ by level.** EDs, small areas and NUTS3 codes are from Census 2022. LEAs are
  those used in the 2019 and 2024 local elections. Constituencies are from the 2023 Electoral
  (Amendment) Act. Check the `vintages` field before joining data from an earlier census or a
  different electoral period.

## Licence

The table is derived from data published by the Central Statistics Office and Tailte Éireann. Both
are licensed under CC BY 4.0. Cite: "Contains Central Statistics Office (CSO) Census 2022 data and
Tailte Éireann boundary data, both licensed under CC BY 4.0."
