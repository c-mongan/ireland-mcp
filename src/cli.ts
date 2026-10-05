#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createContext } from "./gateway/context.js";
import { createAppServer } from "./registry.js";

async function main(): Promise<void> {
  const server = createAppServer(createContext());
  await server.connect(new StdioServerTransport());
}

main().catch(() => {
  console.error("ireland-mcp failed to start.");
  process.exit(1);
});
