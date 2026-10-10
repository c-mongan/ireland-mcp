/* global AbortSignal */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// With no argument, start and stop an owned loopback-only Storybook server.
// A supplied URL checks an already running local or published MCP endpoint.
const endpoint = new URL(process.argv[2] ?? "http://localhost:6007/mcp");
const client = new Client({ name: "ireland-storybook-mcp-check", version: "1.0.0" });
let server;
let serverError;
let startupLog = "";

const textOf = (result) => {
  assert.notEqual(result.isError, true, "MCP tool returned an error");
  return result.content.filter((item) => item.type === "text").map((item) => item.text).join("\n");
};

try {
  if (!process.argv[2]) {
    server = spawn(process.execPath, [
      fileURLToPath(new URL("../node_modules/storybook/dist/bin/dispatcher.js", import.meta.url)),
      "dev", "--host", "127.0.0.1", "--port", "6007", "--exact-port", "--ci", "--no-open", "--disable-telemetry"
    ], { cwd: fileURLToPath(new URL("../", import.meta.url)), stdio: ["ignore", "pipe", "pipe"] });
    server.on("error", (error) => { serverError = error; });
    for (const stream of [server.stdout, server.stderr]) {
      stream.on("data", (chunk) => { startupLog = (startupLog + chunk.toString()).slice(-5000); });
    }
    const deadline = Date.now() + 60_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (serverError || server.exitCode !== null) throw serverError ?? new Error(`Storybook exited: ${startupLog}`);
      try {
        const response = await fetch(new URL("/index.json", endpoint), { signal: AbortSignal.timeout(1000) });
        if (response.ok && startupLog.includes("Storybook ready!")) { ready = true; break; }
      } catch { /* The owned server is still starting. */ }
      await delay(250);
    }
    assert.ok(ready, `Storybook did not start: ${startupLog}`);
  }

  await client.connect(new StreamableHTTPClientTransport(endpoint));
  const tools = (await client.listTools()).tools.map((tool) => tool.name);
  for (const name of ["docs-list", "docs-show", "docs-show-story"]) assert.ok(tools.includes(name), `${name} unavailable`);

  const index = textOf(await client.callTool({ name: "docs-list", arguments: { withStoryIds: true } }));
  const storyIds = [...new Set(index.match(/ireland-mcp-sections--[a-z-]+/g))];
  assert.equal(storyIds.length, 36, "Expected all 36 section stories in MCP documentation");
  const docs = textOf(await client.callTool({ name: "docs-show", arguments: { id: "ireland-mcp-sections" } }));
  for (const value of ["web/index.html", "web/styles.css", "section:", "theme:", "state?:", "Scripts, network access", "./SectionPreview"]) {
    assert.ok(docs.includes(value), `Component documentation is missing ${value}`);
  }
  assert.ok(!docs.includes("from 'ireland-mcp'"), "The preview must not claim a production package export");
  const story = textOf(await client.callTool({ name: "docs-show-story", arguments: { storyId: "ireland-mcp-sections--playground-error-dark" } }));
  assert.match(story, /section="playground" state="error" theme="dark"/);
  let preview;
  if (tools.includes("stories-preview")) {
    preview = textOf(await client.callTool({ name: "stories-preview", arguments: { stories: [{ storyId: "ireland-mcp-sections--playground-error-dark" }] } }));
    assert.ok(preview.includes("ireland-mcp-sections--playground-error-dark"));
  }
  console.log(JSON.stringify({ endpoint: endpoint.href, server: client.getServerVersion(), tools, stories: storyIds.length, calls: ["docs-list", "docs-show", "docs-show-story", ...(preview ? ["stories-preview"] : [])], passed: true }, null, 2));
} finally {
  await client.close();
  if (server && server.exitCode === null) {
    const stopped = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    await Promise.race([stopped, delay(5000)]);
    if (server.exitCode === null && server.signalCode === null) {
      server.kill("SIGKILL");
      await stopped;
    }
  }
}
