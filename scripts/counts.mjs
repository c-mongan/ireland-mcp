#!/usr/bin/env node
// Regenerates every published count from the registry (src/counts.ts): docs/counts.json, the README
// definitions table and live-ops line, and the site's static fallback. Run `npm run counts` after adding
// a source or rerunning live-all-ops; src/counts.test.ts fails CI when anything is out of date.
import { readFileSync, writeFileSync } from "node:fs";
import { COUNTS_END, COUNTS_START, computeCounts, liveOpsSummary, renderCounts } from "../dist/src/counts.js";

const counts = computeCounts();
for (const f of ["docs/counts.json", "web/counts.json"]) writeFileSync(f, `${JSON.stringify(counts, null, 2)}\n`);

const between = (text, start, end, body, file) => {
  const a = text.indexOf(start);
  const b = text.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error(`${file}: missing ${start} … ${end} markers`);
  return text.slice(0, a) + body + text.slice(b + end.length);
};

let readme = readFileSync("README.md", "utf8");
readme = between(readme, COUNTS_START, COUNTS_END, renderCounts(counts), "README.md");
const live = liveOpsSummary(readFileSync("docs/live-all-ops.md", "utf8"));
readme = between(readme, "<!-- live-ops:start -->", "<!-- live-ops:end -->", `<!-- live-ops:start -->${live}<!-- live-ops:end -->`, "README.md");
writeFileSync("README.md", readme);

const html = readFileSync("web/index.html", "utf8").replace(/(<dd id="stat-sources">)\d+(<\/dd>)/, `$1${counts.sources}$2`).replace(/(<dd id="stat-ops">)\d+(<\/dd>)/, `$1${counts.default_tools}$2`);
writeFileSync("web/index.html", html);
console.log(JSON.stringify(counts));
