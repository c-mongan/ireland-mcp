// Copies non-TypeScript runtime assets and marks the CLI executable.
import { chmodSync, existsSync, copyFileSync, mkdirSync } from "node:fs";

const cli = new URL("../dist/src/cli.js", import.meta.url);
if (existsSync(cli)) chmodSync(cli, 0o755);

const kohesio = new URL("../dist/src/sources/kohesio/", import.meta.url);
mkdirSync(kohesio, { recursive: true });
copyFileSync(new URL("../src/sources/kohesio/snapshot.json", import.meta.url), new URL("snapshot.json", kohesio));
