import { expect, test } from "vitest";
import { connectClient } from "./helpers/mcpClient.js";
import { createAppServer } from "../src/registry.js";
import { createContext } from "../src/gateway/context.js";

test("the compact catalogue exposes tourism, static stops and groundwater without adding default tools", async () => {
  const connected = await connectClient(createAppServer(createContext({ fetch: async () => { throw new Error("Catalogue must not download datasets"); } })));
  try {
    const listed = await connected.listTools();
    expect(listed.tools).toHaveLength(7);
    const result = await connected.callTool({ name: "ireland_catalogue", arguments: {} });
    expect(JSON.stringify(result)).toContain('"failte-ireland"');
    expect(JSON.stringify(result)).toContain('"tfi-static"');
    expect(JSON.stringify(result)).toContain('"gsi"');
  } finally {
    await connected.close();
  }
});

test("Logainm is discoverable but needs an operator key before making a request", async () => {
  const client = await connectClient(createAppServer(createContext({ env: {}, fetch: async () => { throw new Error("Missing keys must not trigger HTTP"); } })));
  try {
    const result = await client.callTool({ name: "ireland_call", arguments: { source: "logainm", operation: "logainm_search_places", args: { query: "Galway" } } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("NOT_CONFIGURED");
  } finally {
    await client.close();
  }
});
