// Copies non-TypeScript runtime assets and marks the CLI executable.
import { chmodSync, existsSync, copyFileSync, mkdirSync, cpSync } from "node:fs";

const cli = new URL("../dist/src/cli.js", import.meta.url);
if (existsSync(cli)) chmodSync(cli, 0o755);

const kohesio = new URL("../dist/src/sources/kohesio/", import.meta.url);
mkdirSync(kohesio, { recursive: true });
copyFileSync(new URL("../src/sources/kohesio/snapshot.json", import.meta.url), new URL("snapshot.json", kohesio));

const legal = new URL("../dist/packages/irish-legal-mcp/", import.meta.url);
mkdirSync(legal, { recursive: true });
for (const directory of ["src", "ui"]) cpSync(new URL(`../packages/irish-legal-mcp/${directory}/`, import.meta.url), new URL(`${directory}/`, legal), { recursive: true });
copyFileSync(new URL("../packages/irish-legal-mcp/seeds.json", import.meta.url), new URL("seeds.json", legal));
copyFileSync(new URL("../packages/irish-legal-mcp/package.json", import.meta.url), new URL("package.json", legal));

