import { HttpRequest } from "@azure/functions";
import { describe, expect, it } from "vitest";
import { mcpHandler } from "./mcp.js";

describe("Azure MCP request boundary", () => {
  it("applies its 256 KiB byte limit to undeclared multibyte bodies", async () => {
    const request = new HttpRequest({ method: "POST", url: "https://fn.example/mcp", body: { string: "€".repeat(100_000) } });
    const response = await mcpHandler(request);
    expect(response.status).toBe(413);
  });

  it("still serves discovery through the Azure Function adapter", async () => {
    const request = new HttpRequest({ method: "POST", url: "https://fn.example/mcp", headers: {
      "content-type": "application/json", accept: "application/json, text/event-stream"
    }, body: { string: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) } });
    const response = await mcpHandler(request);
    expect(response.status).toBe(200);
    const body = JSON.parse(String(response.body));
    expect(body.result.tools.map((tool: { name: string }) => tool.name).sort()).toEqual([
      "fetch", "ireland_about", "ireland_call", "ireland_catalogue", "ireland_describe", "nearby", "search"
    ]);
  });
});
