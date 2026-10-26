// Copies non-TypeScript runtime assets and marks the CLI executable.
import { chmodSync, existsSync, copyFileSync, mkdirSync, cpSync } from "node:fs";

const cli = new URL("../dist/src/cli.js", import.meta.url);
if (existsSync(cli)) chmodSync(cli, 0o755);

const kohesio = new URL("../dist/src/sources/kohesio/", import.meta.url);
mkdirSync(kohesio, { recursive: true });
copyFileSync(new URL("../src/sources/kohesio/snapshot.json", import.meta.url), new URL("snapshot.json", kohesio));

// Published snapshots: the static site serves web/data and the MCP tools read the same files from dist/web/data.
const PUBLISHED_DATA = ["cib/cis-annual.json", "cib/cis-query-categories.json", "cib/cips-annual.json", "civic-directory.json", "crosswalk/places-2022.json"];
for (const file of PUBLISHED_DATA) {
  const target = new URL(`../dist/web/data/${file}`, import.meta.url);
  mkdirSync(new URL("./", target), { recursive: true });
  copyFileSync(new URL(`../web/data/${file}`, import.meta.url), target);
}

const legal = new URL("../dist/packages/irish-legal-mcp/", import.meta.url);
mkdirSync(legal, { recursive: true });
for (const directory of ["src", "ui"]) cpSync(new URL(`../packages/irish-legal-mcp/${directory}/`, import.meta.url), new URL(`${directory}/`, legal), { recursive: true });
copyFileSync(new URL("../packages/irish-legal-mcp/seeds.json", import.meta.url), new URL("seeds.json", legal));
copyFileSync(new URL("../packages/irish-legal-mcp/package.json", import.meta.url), new URL("package.json", legal));

