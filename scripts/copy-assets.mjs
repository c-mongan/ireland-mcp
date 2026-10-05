// Copies non-TypeScript runtime assets (none required today) and marks the CLI executable.
import { chmodSync, existsSync } from "node:fs";

const cli = new URL("../dist/src/cli.js", import.meta.url);
if (existsSync(cli)) chmodSync(cli, 0o755);
