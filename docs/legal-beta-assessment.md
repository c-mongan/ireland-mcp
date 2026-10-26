# Legal pilot: beta assessment

Assessed 26 October 2026. This note decides how the optional Irish legal and
Citizens Information pilot (`packages/irish-legal-mcp`) is presented. It is not
legal advice and it does not certify any source as current law.

**Decision:** show the pilot as a visible **beta** on the website and in the
README. Keep `LEGAL_ENABLED` **off by default**. The hosted endpoint
(`mcp.irishopendata.ie`) does not run it as of 26 October 2026
(`/legal/api/status` returns HTTP 404). Self-hosters can turn it on.

## What it covers today

The pilot reads only the pages in [`seeds.json`](../packages/irish-legal-mcp/seeds.json).
The subject is employment: annual leave and working time.

| Source | Pages | What it is |
| --- | --- | --- |
| Citizens Information | Annual leave; Working hours | Plain-English guidance |
| Irish Statute Book (eISB) | Organisation of Working Time Act 1997, enacted XML | The Act **as passed in 1997** |
| Irish Statute Book (eISB) | Legislation effects page for the 1997 Act | Recorded amendments and commencements |

There is no case law, no national consolidation and no other subject area in
the pilot. Separately, the default `legislation` source (always on) reads Acts,
statutory instruments, the Constitution and the Legislation Directory live from
the Irish Statute Book, as enacted or made. See
[source policies](irish-legal-source-policies.md#live-legislation-tools-on-the-default-surface).
An empty search result means "not in this small corpus". It does not mean the
law is silent.

## Licences

| Source | Terms | How the pilot handles it |
| --- | --- | --- |
| [Citizens Information Board](https://www.citizensinformation.ie/en/about/copyright/) | CC BY 4.0; third-party material excluded | Stores approved article paths; keeps attribution in every result |
| [Irish Statute Book](https://www.irishstatutebook.ie/eli/open-data.html) | Oireachtas (Open Data) PSI Licence, which incorporates CC BY 4.0 | Stores approved eISB paths; keeps attribution |
| [Law Reform Commission Revised Acts](https://revisedacts.lawreform.ie/) | Public, but bulk storage and redistribution need explicit permission | **Not included.** Disabled unless an operator attests permission with `LEGAL_REVISED_ACTS_PERMISSION=true` |
| BAILII (judgments) | Automated harvesting restricted | Not supported |

See [source policies](irish-legal-source-policies.md) for the full rules.

## Access finding: Citizens Information blocks automated clients

On 26 October 2026, `www.citizensinformation.ie` returned **HTTP 403 from its
CloudFront firewall** to non-browser clients. Results of plain requests, with no
browser user-agent spoofing:

| Request | User-agent | Result |
| --- | --- | --- |
| `robots.txt`, sitemap, `/en/`, copyright page | `ireland-mcp-research/0.1` | 403 (CloudFront) |
| `curl -I https://www.citizensinformation.ie/robots.txt` | `IrelandLegalMCP/0.1` | 403 (CloudFront), 13:41 UTC |
| Same URL | `IrelandLegalMCP/0.1 (+https://github.com/c-mongan/ireland-mcp)` (the exact string the pilot sends) | 403 |
| `https://www.irishstatutebook.ie/robots.txt` | Same pilot string | 404 (treated as no robots rules) |

**Effect on a sync today:** the ingester stops a source when `robots.txt`
returns any status other than 2xx, 404 or 410
([`ingest.mjs`](../packages/irish-legal-mcp/src/ingest.mjs), `checkRobots`).
Each seed fails separately, so a sync is expected to record two Citizens
Information failures. The two eISB pages can still load. Earlier stored
Citizens Information evidence is kept and marked stale. This is expected
behaviour, not a bug to work around.

**What we will not do:** spoof a browser user-agent, ignore robots rules or use
a headless browser to get past the firewall. Public availability and robots
access do not grant a reuse licence either.

**Path to more coverage:** ask the Citizens Information Board for permission
to access the pages automatically, or for an official export or feed. A request
to `psi@ciboard.ie` is being drafted. Until CIB replies, Citizens Information
coverage stays at the two seeded pages, and only if a sync can reach them.

## Accuracy and currency risks

1. **Enacted is not current.** The eISB XML is the 1997 Act as passed. Later
   amendments and commencement orders are not applied to the text. The effects
   page lists them, but someone still has to read them.
2. **Guidance can lag.** Citizens Information pages are updated by the
   publisher. A stored copy may be older than the live page.
3. **`as_of` is a snapshot choice.** It selects a stored, publisher-dated copy.
   It does not rebuild the law as it stood on that date.
4. **AI summaries are unverified.** The optional chat can use an Azure OpenAI
   model. Output must cite stored documents with exact quotes, otherwise it
   falls back to excerpts. That check proves quotes exist. It does not prove the
   interpretation is right.
5. **Failed syncs leave stale evidence.** Results carry stale flags and dates.
   Users must read them.

## How someone can try it

Standalone pilot (no `LEGAL_ENABLED` flag needed):

```sh
npm run legal:sync     # fetch the seed pages into .irish-legal-cache
npm run legal:serve    # chat page and MCP at http://127.0.0.1:4173
```

`legal:sync` exits with code 1 when any seed fails. While Citizens Information
returns 403, expect that exit code; the eISB pages are still committed. Run the
steps one at a time rather than in a script that stops on the first error.

Inside the main server, from the repository root:

```sh
npm run legal:sync
npm run build
LEGAL_ENABLED=true npm run dev:http
```

Azure deployments need the storage and model settings in the
[pilot README](../packages/irish-legal-mcp/README.md#azure-integration).

## What users must be told

- This is **not legal advice**. For your own situation, use Citizens
  Information, the Workplace Relations Commission or a solicitor.
- It covers **annual leave and working time only**.
- Act text is **as passed** and may not include later changes.
- Check the cited source and its date before relying on an answer.

## Why beta, and why off by default

- The safeguards are solid: versioned evidence, citations, attribution, stale
  flags and currency warnings on every answer.
- The coverage is too narrow for a default tool. Turning it on everywhere would
  invite questions it cannot answer well.
- A hosted deployment needs operator-managed storage and scheduled refreshes,
  which the default public deployment does not enable.
- Citizens Information, the main plain-English source, currently refuses
  automated access (see above).

## What would move it out of beta

1. Written permission or an official export from the Citizens Information
   Board, so its guidance can be refreshed reliably.
2. Broader seeds across common Citizens Information topics, such as
   employment, housing and social welfare, with a coverage report.
3. Written reuse permission for Revised Acts, or a clear decision to stay on
   enacted text plus legislative effects.
4. A hosted deployment whose sync succeeds against the live publishers, passes
   the deployment check in `scripts/deploy-legal.mjs` and has a recorded,
   passing `live:sanity` case for the legal operations.
5. Authenticated per-user quotas at the edge if model-generated chat is offered.
6. A user-facing coverage page showing what is and isn't indexed, and a review
   of the public wording with the warnings above in place.
