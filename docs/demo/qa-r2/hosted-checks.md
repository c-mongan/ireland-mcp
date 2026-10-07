# Hosted QA round-2 checks (2026-10-07T23:10:34.237Z)

Endpoint: https://func-ireland-mcp-aofsjpwgy4hva.azurewebsites.net/mcp (v1.1.1)

## H1 Galway West current TDs

```json
{
 "ms": 140,
 "names": [
  "John Connolly",
  "Mairéad Farrell",
  "Noel Grealish",
  "Seán Kyne",
  "Hildegarde Naughton"
 ],
 "connolly": true,
 "note": "1 former member(s) matching this search whose seat has ended are excluded; set include_former=true to list them."
}
```

## H2 EPA bathing paging

```json
{
 "pages": 11,
 "rows": 77,
 "salthill": {
  "beach_id": "IEWEBWC170_0000_0200",
  "beach_name": "Salthill Beach",
  "county_name": "Galway",
  "local_authority_name": "Galway City Council",
  "beach_type": "Identified Beach",
  "easting": 127151,
  "northing": 223210,
  "annual_water_quality_assessment": "Salthill Beach is classified as achieving Excellent Water Quality in 2025 based on the assessment of bacteriological results for the period 2022 to 2025. Salthill Beach has achieved an Excellent Water Quality rating for the four consecutive years 2022 to 2025. Annual water quality ratings are generally calculated using monitoring results over a four-year period and are assessed against stringent bacterial limits to protect bather health.",
  "has_all_season_bathing_restriction_in_place": "No",
  "reason_for_all_season_bathing_restriction": null,
  "next_monitoring_date": null,
  "beach_profile_url": "https://www.beaches.ie/wp-content/files//profile/BWPR00857_2026_01_profile.pdf"
 }
}
```

## H3 breaker after 6 bad NCSE calls

```json
{
 "bad": [
  "BAD_ARGS",
  "BAD_ARGS",
  "BAD_ARGS",
  "BAD_ARGS",
  "BAD_ARGS",
  "BAD_ARGS"
 ],
 "good_ok": true
}
```

## H4 search Kilkee

```json
{
 "ms": 1377,
 "results": [
  "Recorded crime incidents (New Garda Operating Model) (CSO CJA11)",
  "KILKEE: Disadvantaged",
  "Kilkee (Wikidata Q1588602)"
 ]
}
```

## H4 search Westport

```json
{
 "ms": 1539,
 "results": [
  "Persons on Live Register (CSO LRM07)",
  "WESTPORT URBAN: Marginally Above Average",
  "Westport (Wikidata Q1017331)"
 ]
}
```

## M6 4xx/BAD_ARGS message

```json
{
 "code": "BAD_ARGS",
 "message": "Unknown arguments for met_get_forecast: latitude, longitude. Valid arguments: lat, lon, hours.",
 "hint": "Check the tool arguments against its input schema."
}
```
{"pages":28,"rows":243,"unique":243,"total":243,"salthill":true}
