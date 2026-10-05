#!/usr/bin/env node
// Measures the tools/list payload a client sees. Run `npm run build` first.
// Usage: npm run measure:tools [-- all | cso,irish-rail]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createContext } from "../dist/src/gateway/context.js";
import { createAppServer } from "../dist/src/registry.js";

const toolsets = process.argv[2];
const server = createAppServer(createContext(), undefined, toolsets);
const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
await server.connect(serverSide);
const client = new Client({ name: "measure-tools", version: "1.0.0" });
await client.connect(clientSide);
const { tools } = await client.listTools();
const size = JSON.stringify({ tools }).length;
console.log(`toolsets=${toolsets ?? "(default)"}: ${tools.length} tools, ${size} chars (≈${Math.round(size / 4)} tokens)`);
await client.close();
