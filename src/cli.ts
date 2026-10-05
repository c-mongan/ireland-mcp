#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createContext } from "./gateway/context.js";
import { toolsetsFromArgs, UnknownToolsetError } from "./gateway/toolsets.js";
import { createAppServer } from "./registry.js";

async function main(): Promise<void> {
  // --toolsets=cso,irish-rail (or IRELAND_MCP_TOOLSETS) adds typed tools; "all" lists every one.
  const server = createAppServer(createContext(), undefined, toolsetsFromArgs(process.argv.slice(2), process.env));
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  console.error(error instanceof UnknownToolsetError ? `ireland-mcp: ${error.message}` : "ireland-mcp failed to start.");
  process.exit(1);
});
