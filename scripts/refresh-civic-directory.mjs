// Run after npm run build, from the repository checkout. No hosted request uses this code.
// Usage: node scripts/refresh-civic-directory.mjs <40-character commit SHA of williamkennedy/eire_civic_tech_directory>
import { rename, writeFile } from "node:fs/promises";
import { refreshDirectory } from "../dist/src/sources/civic-directory/refresh.js";

if (process.argv.length !== 3) throw new Error("Usage: node scripts/refresh-civic-directory.mjs <commit-sha>");
const snapshot = await refreshDirectory(process.argv[2]);
const destination = new URL("../web/data/civic-directory.json", import.meta.url);
const temporary = new URL(`../web/data/civic-directory.json.${process.pid}.tmp`, import.meta.url);
await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: "wx" });
await rename(temporary, destination);
console.log(`Validated ${snapshot.projects.length} projects at ${snapshot.commit}. Review the diff, then run npm test and npm run build.`);
