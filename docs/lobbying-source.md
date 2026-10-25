# Lobbying.ie source

The `lobbying` source searches the public Register of Lobbying, which the Standards in Public Office Commission (SIPO) maintains on [Lobbying.ie](https://www.lobbying.ie/).

## Data and limits

The source uses the official paged search endpoint at `https://api.lobbying.ie/api/Search`. It accepts one-based page numbers up to 100,000 and page sizes from 1 to 100. The live endpoint uses one-based `currentPage` values; `currentPage=0` returns the first page again. The source reports the API's total and the next page when one is available.

The source returns public register fields, including the resolved lobbyist name, return link, period, matter and policy details, DPO information, intended results, lobbying activities, nil-return flag, and return-version type. It omits account IDs, editor details, and contact data. Missing public fields are returned as `null`.

`SubmittedDate` is returned as `submitted_at` in the exact ISO timestamp form supplied by the search endpoint. `submitted_date` contains its `YYYY-MM-DD` calendar date. The source requires the API timestamp to include an explicit offset or `Z`, and preserves it in `submitted_at`. It does not invent a time zone or treat submission time as independently verified publication time.

If both dates are missing, the source searches from 1 January of the current year through today. If only `date_to` is set, the source starts on 1 January of that date's year. If only `date_from` is set, the source ends on 31 December of that date's year, or today when today comes first. The source rejects a start date after the end date. Each request can cover up to 366 days. Split a longer search into shorter date ranges. The response shows the effective dates.

Each result is a published return. The source does not count meetings or lobbying communications. It preserves the `NilReturn` and `ReturnVersionType` values from the search result; it does not infer their meaning.

The source rejects a response if a row is explicitly marked as a draft, awaiting publication, unpublished, or not visible to the public.

The source validates the search response and public return links before it caches data. It reads at most 5 MiB per response and caches valid results for one hour.

## Re-use and attribution

SIPO states that information on Lobbying.ie may be reused subject to the latest PSI licence. Reuse must acknowledge the source and SIPO copyright, reproduce information accurately, and avoid misleading use. See [SIPO's reuse policy](https://www.lobbying.ie/about-us/our-policies/reuse-of-public-sector-information/).

The source envelope uses this attribution: “Contains data from the Register of Lobbying, © Standards in Public Office Commission, published on Lobbying.ie.” It identifies the licence as the PSI General Licence for Re-use of Public Sector Information. It does not label the data CC BY 4.0.
