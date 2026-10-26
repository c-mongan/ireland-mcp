// Run after npm run build, from the repository checkout. No hosted request uses this code.
// Downloads the pinned Citizens Information Board reports, validates every figure, then replaces all three files together.
import { rename, writeFile } from "node:fs/promises";
import { refreshCib } from "../dist/src/sources/cib/refresh.js";

const built = await refreshCib();
const outputs = [["cis-annual.json", built.cisAnnual], ["cis-query-categories.json", built.cisCategories], ["cips-annual.json", built.cips]];
const staged = [];
for (const [name, data] of outputs) {
  const destination = new URL(`../web/data/cib/${name}`, import.meta.url);
  const temporary = new URL(`../web/data/cib/${name}.${process.pid}.tmp`, import.meta.url);
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { flag: "wx" });
  staged.push([temporary, destination]);
}
for (const [temporary, destination] of staged) await rename(temporary, destination);
for (const f of built.failed) console.log(`Known publisher inconsistency recorded: ${f.key} (${f.detail})`);
console.log("Wrote web/data/cib/*.json. Review the diff, then run npm test and npm run build.");
