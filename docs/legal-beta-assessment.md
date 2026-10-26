# Legal pilot: beta assessment

Date: 26 October 2026. Decision: show the legal pilot as a **beta** on the
website and README. Keep `LEGAL_ENABLED` **off by default**.

## In plain English

The pilot lets an assistant quote Irish employment-rights guidance and the
underlying Act, with links back to the publisher. It covers one topic today:
annual leave and working hours. It is not legal advice and it cannot tell you
whether a law is in force today.

## What it covers

| Area | Coverage in this revision |
| --- | --- |
| Citizens Information guidance | Two seed pages: annual leave, and working hours ([seeds.json](../packages/irish-legal-mcp/seeds.json)). |
| Irish Statute Book | Organisation of Working Time Act 1997 (as enacted, XML) and its legislative-effects page. |
| Revised Acts (consolidated law) | Not stored. Disabled until the Law Reform Commission grants reuse permission. |
| Court judgments | Not supported. No BAILII crawler or mirror. |

Missing results mean "not in this small corpus", not "no such law".

## Licences

| Publisher | Terms | Status |
| --- | --- | --- |
| Citizens Information Board | CC BY 4.0; third-party material excluded | Usable with attribution. |
| Irish Statute Book (Office of the Attorney General) | PSI General Licence / CC BY 4.0 | Usable with attribution. |
| Law Reform Commission Revised Acts | Public, but storage and redistribution need explicit permission | Gated by `LEGAL_REVISED_ACTS_PERMISSION`, which records an operator attestation and does not grant rights. |

Details: [legal source policies](irish-legal-source-policies.md).

## Accuracy and currency risks

1. **Enacted is not current.** The 1997 Act text is the original wording.
   Later amendments and commencement orders are not applied.
2. **Guidance can lag the law.** Citizens Information pages carry their own
   update dates. Responses show them but cannot certify them.
3. **Historical `as_of` is approximate.** It picks a stored, publisher-dated
   snapshot. It does not reconstruct the law in force on that date.
4. **Generated answers are unverified.** Optional model output must quote known
   sources. That checks the quotes, not the legal interpretation.
5. **Sync can go stale.** A failed refresh keeps old evidence and marks it stale.

## Why beta, and why off by default

- The safeguards are solid: versioned evidence, citations, attribution, stale
  flags and currency warnings on every answer.
- The coverage is too narrow for a default tool. Turning it on everywhere would
  invite questions it cannot answer well.
- A hosted deployment needs operator-managed storage and scheduled refreshes,
  which the default public deployment does not enable.

## What would move it out of beta

1. Broader seeds across common Citizens Information topics, such as
   employment, housing and social welfare, with a coverage report.
2. Written reuse permission for Revised Acts, or a clear decision to stay on
   enacted text plus legislative effects.
3. A hosted deployment with a recorded, passing `live:sanity` case for the
   legal operations.
4. A user-facing coverage page showing what is and isn't indexed.

## How to try it

Locally, follow the [pilot README](../packages/irish-legal-mcp/README.md):
run `npm run legal:sync`, then `npm run legal:serve`. On your own Azure
deployment, set `LEGAL_ENABLED=true` and the storage settings listed there.
