#!/usr/bin/env node
// Discovery probe for the dataset-card pillar. For each benchmark item tagged dataset-card:*, it asks the
// server the question an agent would naturally ask (a CSO keyword search, and a filtered catalogue call) and
// records the rank of the table or operation the reference needs. Hit@5 is the headline number.
//
//   npm run build && node evals/multistep/discovery.mjs [--url <mcp endpoint>] [--out evals/multistep/out]
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { connect } from "./lib.mjs";

/** Natural agent queries per item. `expect` lists every table code that answers the step. */
export const SEARCH_PROBES = [
  { item: "t2-dublin-ppr-vs-rppi", query: "residential property price index", expect: ["HPM09"] },
  { item: "t2-munster-unemployment-popchange", query: "unemployment rate local authority", expect: ["CPNI37"] },
  { item: "t2-munster-unemployment-popchange", query: "population change local authority", expect: ["CPNI05"] },
  { item: "t2-cork-housing-spend-per-capita", query: "population council", expect: ["FY003A", "F1004A"] },
  { item: "t2-cork-housing-spend-per-capita", query: "population local authority", expect: ["FY003A", "F1004A"] },
  { item: "t2-rent-law-rpz", query: "RTB average monthly rent", expect: ["RIA02"] },
  { item: "t2-dataset-discovery-lea", query: "new dwelling completions local electoral area", expect: ["NDA05", "NDQ09"] },
  { item: "t2-dataset-discovery-lea", query: "completions LEA", expect: ["NDA05", "NDQ09"] },
  { item: "t2-dataset-discovery-lea", query: "arrivals from Ukraine local electoral area", expect: ["UA05"] },
  { item: "t2-dataset-discovery-lea", query: "Ukraine LEA", expect: ["UA05"] }
];

/** Filtered catalogue calls: the expected operation must be listed. */
export const CATALOGUE_PROBES = [
  { item: "t2-dataset-discovery-lea", args: { geo_level: "lea", topic: "housing" }, expect: "cso/cso_search_tables" },
  { item: "t2-cork-housing-spend-per-capita", args: { geo_level: "local_authority", topic: "public-finance" }, expect: "council-budgets/council_budgets_get" },
  { item: "t2-munster-unemployment-popchange", args: { geo_level: "local_authority", topic: "labour" }, expect: "cso/cso_get_data" },
  { item: "t3-ballymun-vs-tallaght", args: { join_key: "ed_code", topic: "deprivation" }, expect: "pobal/pobal_deprivation_search" },
  { item: "t2-dublin-ppr-vs-rppi", args: { topic: "property", has_time_series: true, geo_level: "county" }, expect: "ppr/ppr_price_stats" }
];

const parse = (res) => {
  const text = res.content?.[0]?.text ?? "{}";
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
};

export async function runDiscovery(client) {
  const search = [];
  for (const p of SEARCH_PROBES) {
    const res = parse(await client.callTool({ name: "ireland_call", arguments: { source: "cso", operation: "cso_search_tables", args: { query: p.query, limit: 50 } } }));
    const codes = (res.data ?? []).map((t) => t.code);
    const idx = codes.findIndex((c) => p.expect.includes(c));
    search.push({ ...p, rank: idx < 0 ? null : idx + 1, top: codes.slice(0, 3), error: res.error?.code ?? null });
  }
  const catalogue = [];
  for (const p of CATALOGUE_PROBES) {
    const res = parse(await client.callTool({ name: "ireland_catalogue", arguments: p.args }));
    const filtered = Boolean(res.filters);
    const ops = (res.domains ?? []).flatMap((d) => d.sources.flatMap((s) => s.operations.map((o) => `${s.id}/${o}`)));
    catalogue.push({ ...p, supported: filtered, listed: filtered && ops.includes(p.expect), operations: filtered ? ops.length : null });
  }
  return { search, catalogue };
}

export function renderDiscovery({ search, catalogue }) {
  const hit = (k) => search.filter((s) => s.rank !== null && s.rank <= k).length;
  const lines = [
    "## Discovery probes (dataset-card items)",
    "",
    `CSO search: hit@1 ${hit(1)}/${search.length}, hit@5 ${hit(5)}/${search.length}, hit@50 ${hit(50)}/${search.length}. Filtered catalogue: ${catalogue.filter((c) => c.listed).length}/${catalogue.length} list the needed operation.`,
    "",
    "| Item | cso_search_tables query | Needed | Rank | Top 3 |",
    "| --- | --- | --- | ---: | --- |",
    ...search.map((s) => `| ${s.item} | ${s.query} | ${s.expect.join(" or ")} | ${s.rank ?? "not in top 50"} | ${s.top.join(", ")} |`),
    "",
    "| Item | ireland_catalogue arguments | Needed operation | Listed | Operations returned |",
    "| --- | --- | --- | --- | ---: |",
    ...catalogue.map((c) => `| ${c.item} | \`${JSON.stringify(c.args)}\` | ${c.expect} | ${c.supported ? (c.listed ? "yes" : "no") : "filters unsupported"} | ${c.operations ?? "all"} |`)
  ];
  return lines.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const opt = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const client = await connect({ url: opt("--url") });
  try {
    const result = await runDiscovery(client);
    const md = renderDiscovery(result);
    const out = opt("--out") ?? "evals/multistep/out";
    await mkdir(out, { recursive: true });
    await writeFile(`${out}/discovery.json`, JSON.stringify(result, null, 2));
    await writeFile(`${out}/discovery.md`, `${md}\n`);
    console.log(md);
  } finally {
    await client.close();
  }
}
