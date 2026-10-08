// Run after npm run build, from the repository checkout. No hosted request uses this code.
import { writeFile, rename } from "node:fs/promises";
import { refreshSnapshot } from "../dist/src/sources/kohesio/refresh.js";

if (process.argv.length !== 3) throw new Error("Usage: node scripts/refresh-kohesio.mjs YYYY-MM-DD (verified official export directory date)");
const snapshot = await refreshSnapshot(process.argv[2]);
const destination = new URL("../src/sources/kohesio/snapshot.json", import.meta.url);
const temporary = new URL(`../src/sources/kohesio/snapshot.${process.pid}.tmp`, import.meta.url);
await writeFile(temporary, JSON.stringify(snapshot) + "\n", { flag: "wx" });
await rename(temporary, destination);
console.log(`Validated ${snapshot.projects.length} Irish projects. Review snapshot.json, rebuild, test and redeploy to publish.`);
