# Irish legal source permissions and coverage

| Source | Purpose | Default storage | Attribution and limits |
| --- | --- | --- | --- |
| [Citizens Information](https://www.citizensinformation.ie/en/about/copyright/) | Explanatory guidance | Enabled for approved article paths | CC BY 4.0; preserve Citizens Information Board attribution; third-party material excluded |
| [Irish Statute Book](https://www.irishstatutebook.ie/eli/open-data.html) | Enacted Acts, made instruments and legislative effects | Enabled for approved eISB paths | [Oireachtas (Open Data) PSI Licence](https://www.irishstatutebook.ie/eli/open-data.html), which incorporates CC BY 4.0; source-specific attribution retained |
| [Law Reform Commission Revised Acts](https://revisedacts.lawreform.ie/) | Administrative consolidations and annotations | Disabled until explicit reuse permission | Public availability does not itself establish bulk storage/redistribution rights; retain cutoff and editorial warnings |
| [BAILII](https://www.bailii.org/bailii/copyright.html) | Judgments | Unsupported | Automated harvesting is restricted; no BAILII crawler or mirror is supplied |

The eISB open-data page (checked 26 October 2026) states: "Re-use of the data on this web site is subject to the OIREACHTAS (OPEN DATA) PSI LICENCE … This licence incorporates the Creative Commons Attribution 4.0 International License". The older `eli/copyright.html` link returns HTTP 404. The eISB has no `robots.txt` (HTTP 404).

An operator must confirm applicable terms, exclusions and permission scope before extending a production corpus. `LEGAL_REVISED_ACTS_PERMISSION` records an operator's attestation; it does not grant publisher rights. Robots permission does not grant a reuse licence. Attribution belongs in tool results and citations, not only in this document.

The default subject is employment: annual leave and working time. There is no comprehensive judgment archive, nationwide consolidation corpus or automatic current-law certification. Irish legal researchers should verify amendments, commencement, relevance and source currency through the cited publisher evidence.

International comparison informed the design: legislation.gov.uk, EUR-Lex, France's Légifrance, US CourtListener and national open-data portals demonstrate structured legal/public-data access. This implementation adds no third-party mirrors or unverified external MCP endpoints; those require separate source adapters and licence review. Existing Ireland MCP sources already provide global datasets through Eurostat, ECB, World Bank and Wikidata.

## Live legislation tools on the default surface

The default `legislation` source reads the Irish Statute Book live, with a cache, and stores no corpus. It does not use the optional pilot or the Revised Acts.

| Operation | Upstream page | Cache | Main limits |
| --- | --- | --- | --- |
| `legislation_list_acts`, `legislation_get_act`, `legislation_get_section` | `/eli/{year}/act/`, `/eli/{year}/act/{n}/enacted/en/xml` | 1 day | Text as enacted, not as amended |
| `legislation_get_act_effects` | `/eli/isbc/{year}_{n}.html` (Legislation Directory) | 1 day | Directory entries, not amended text; the section filter is a best-effort text match |
| `legislation_list_sis`, `legislation_get_si` | `/eli/{year}/si/`, `/eli/{year}/si/{n}/made/en/html` | 1 day (list), 7 days (SI) | Text as made; SI XML is not published (HTTP 404) |
| `legislation_get_constitution_article` | `/eli/cons/en/html`, `/eli/cons/ga/html` | 7 days | eISB edition (printed January 2020); references follow the printed numbering because some eISB anchors do not |
| `oireachtas_get_bill` (source `oireachtas`) | Oireachtas API `/v1/legislation?act_year&act_no` or `?bill_year&bill_no` | 1 hour | Bill stages and versions; the enacted Act's eISB ELI link is built from `act.actYear`/`act.actNo` |
| `eu_law_lookup` (source `eu-law`) | Publications Office Cellar SPARQL, one bounded `SELECT … LIMIT 50` per CELEX or ELI | 7 days | Metadata only; EUR-Lex is linked, never fetched |

EU law licence: the data.europa.eu record for the Cellar SPARQL endpoint (dataset `sparql-cellar-of-the-publications-office`, checked 26 October 2026, publisher Publications Office of the European Union) lists every distribution, including the SPARQL endpoint, under `http://data.europa.eu/eli/dec/2011/833/oj`, the European Commission reuse notice. The Publications Office copyright notice refers Cellar reuse questions to op-copyright@publications.europa.eu. Responses therefore cite Decision 2011/833/EU and do not claim CC BY 4.0. EUR-Lex HTML blocked automated requests during testing and is not fetched.

Every eISB response carries the Oireachtas (Open Data) PSI Licence attribution, the retrieval time and a "Not legal advice" warning. Text and directory responses also warn that enacted or made text is not amended text. Pages that lack the expected markers are rejected and never cached.

Not built: court judgments (courts.ie judgments were offline and BAILII restricts automated harvesting) and Revised Acts content (no reuse licence; it stays behind the pilot permission gate, off by default).
