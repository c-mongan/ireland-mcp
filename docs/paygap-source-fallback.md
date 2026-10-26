# PayGap public source fallback

The tool first requests the annotated CSV from `https://paygap.ie/downloads/annotated`.
Only an HTTP 403 enables the publisher's public GitHub fallback. Normal HTTPS validation stays enabled. Other HTTP errors and malformed primary CSV data do not silently select another source.

## Automatic refresh

The dataset cache lasts one hour. The first request after expiry checks GitHub's latest commit affecting `fullDenormalised.csv` on the publisher's `main` branch. Updates do not need a code change, redeployment, new credentials, or a background job. If nobody calls the tool, it does not fetch data in the background.

The revision lookup is [the publisher's file commit history](https://api.github.com/repos/zenbuffy/irishGenderPayGap/commits?sha=main&path=fullDenormalised.csv&per_page=1). Unrelated repository commits do not change the snapshot date. After validating the full commit SHA and timestamp, the tool reads the CSV at that exact immutable revision. It never reads changing `main` content as report data.

Concurrent requests share a refresh. Validated CSV content is cached by commit for 30 days, so an unchanged revision does not need another file download. A newly selected revision enters the dataset cache only after its CSV schema and records pass validation. Empty, malformed or unusable replacements are rejected.

The health probe uses the public raw CSV on `main` for basic liveness only. It does not consume GitHub API revision requests or establish data freshness.

## Dates and missing annotations

The envelope URL always identifies the immutable CSV actually used. Fallback dataset metadata includes:

| Field | Meaning |
| --- | --- |
| `snapshot_commit` | Exact publisher revision used for the records. |
| `snapshot_published_at` | CSV commit timestamp, retained under this field name for compatibility. |
| `snapshot_date_basis` | `git_committer_timestamp`; not a reporting period or the time of this request. |
| `snapshot_checked_at` | Last successful revision check and dataset validation. |
| `refresh_interval_seconds` | 3600 seconds. |
| `refresh_mode` | `on_request`. |
| `refresh_status` | `validated`, `cached`, or `failed_using_last_valid`. |
| `annotations_available` | Always false for this curated GitHub export. |

Publication annotations are absent from `fullDenormalised.csv`. Each report marks them unavailable and returns null annotation flags. Null does not mean that the publisher reported no problem. The normal website export keeps its published annotations.

A retryable upstream outage can return the last validated dataset with `stale: true` and `refresh_status: failed_using_last_valid`. Its original commit, snapshot date and check time remain unchanged. If no validated cache exists, or the new data fails schema validation, the call returns an error. A failed refresh never relabels old records with the new commit or today's date. Publisher outages, API limits and schema changes can delay updates; they are not hidden as fresh data.

## Data and maintenance

The [publisher repository](https://github.com/zenbuffy/irishGenderPayGap) licenses the dataset under CC0 1.0. Keep its attribution and the employer report links. The tool retains company names, sites, NACE fields, and 26 metrics. It preserves missing values and zero separately. It excludes invalid report years with an explicit count, and rejects an export with no valid reports.

The separate `gpg.csv` is not used: its quoting is incompatible with the strict scanner. No uncertain annotation joins or export-dialect guesses are made. Company contact data is not fetched.

CSV reads are bounded to 5 MiB and 10,000 rows. Revision metadata is bounded to 100,000 bytes. The metadata API is public and unauthenticated; normal cache hits make no GitHub request. A changed CSV schema requires a reviewed parser update rather than manual snapshot pinning.

Tests simulate new commits, unchanged revisions, cache expiry, simultaneous requests, malformed metadata and data, and outages that preserve the prior snapshot identity. Live checks compare the selected revision and date with the publisher's file history.
