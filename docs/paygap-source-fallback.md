# PayGap public source fallback

The tool first requests the annotated CSV from `https://paygap.ie/downloads/annotated`.
If that request returns HTTP 403, it uses the publisher's public GitHub export.
This uses normal HTTPS access. It does not change TLS checks or bypass the publisher's access controls.
Other HTTP statuses and invalid primary CSV data do not activate the fallback. The source health probe checks the publisher snapshot, so the known website refusal does not falsely mark the available source as down.

The fallback is pinned to commit `a35d6c57d54528d1bd2e339179eab048543fd993`, published on `2026-10-12T03:00:09Z`:

- [fullDenormalised.csv](https://raw.githubusercontent.com/zenbuffy/irishGenderPayGap/a35d6c57d54528d1bd2e339179eab048543fd993/fullDenormalised.csv)
- [Publisher repository and CC0 licence](https://github.com/zenbuffy/irishGenderPayGap)

The returned envelope URL identifies this CSV. Dataset metadata gives the commit, publication date, fallback flag, source URL and coverage note. The snapshot can have different coverage and an earlier update date than the current website export. Cache validation lasts one day. The shared cache can serve a previously validated dataset as stale after an availability failure.

The snapshot contains 4,097 curated report rows for 2022–2025. The tool keeps the publisher's company names, sites, NACE names and codes, report links and 26 metric fields. It preserves blank metrics as null and zero metrics as zero. It excludes missing or invalid years and returns their count. It does not infer a year from a date or company record.

This export has no publication annotations. The fallback returns `annotations_available: false` at the dataset and report levels. Every annotation value is null. Null means unavailable; it does not mean the publisher reported no problem. The normal annotated export retains its published flag values.

The separate `gpg.csv` file has more rows and contains quoting that the strict CSV scanner rejects. It is not used as an inventory or annotation source. The tool does not infer an export dialect or attach annotations by an uncertain match. The separate company export is not fetched, so contact fields are not returned.

To update the snapshot:

1. Check the publisher's repository commit and publication date.
2. Verify `fullDenormalised.csv` at that exact commit with the strict scanner. Check its header, row count, years, metric mapping and NACE fields.
3. Change the commit and publication date in `src/sources/paygap/github.ts` and the test snapshot. Update this note with the observed counts.
4. Run the PayGap tests, TypeScript checks and build. Test the fallback against the pinned public URL with a simulated primary HTTP 403. After deployment, check the same flow from the hosted service.

Both HTTP reads and CSV parsing enforce the existing 5 MiB bound. CSV parsing also enforces the existing 10,000-row bound. A wrong header, malformed quoting or wrong field count fails validation and is not cached.
