#!/usr/bin/env node
/* global AbortController, setTimeout, clearTimeout */
// Native SDK protocol checks. These calls inspect metadata; they do not fetch upstream data.
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const META = ["ireland_catalogue", "ireland_describe", "ireland_call", "ireland_about"];
const sorted = (values) => [...values].sort();
const bodyOf = (result, error = false) => {
  assert.equal(result.isError === true, error, "Unexpected tool result status");
  const body = JSON.parse(result.content.find((part) => part.type === "text")?.text ?? "");
  assert.ok(body && typeof body === "object" && !Array.isArray(body), "Missing JSON object");
  if (!error) assert.ok(!body.error, "Unmarked tool error");
  return body;
};

/** Construct the expected contract from maintained registry metadata, not published counts. */
export function contractFromRegistry({ modules, extraTools, sourceModules, name, version, prompts, operationSchema, exampleArgs }) {
  const operations = modules.flatMap((module) => module.tools.map((tool) => ({
    source: module.info.id, operation: tool.name, schema: operationSchema(tool), example: exampleArgs(tool)
  })));
  return {
    name, version, prompts: [...prompts], sources: sourceModules.length,
    modules: modules.map((module) => ({ id: module.info.id, operations: module.tools.map((tool) => tool.name) })),
    operations,
    defaultTools: [...META, ...extraTools.map((tool) => tool.name), ...modules.flatMap((module) => module.tools.filter((tool) => tool.pinned).map((tool) => tool.name))]
  };
}

function verifyTools(tools, names) {
  assert.deepEqual(sorted(tools.map((tool) => tool.name)), sorted(names), "Tool discovery differs from registry");
  assert.equal(new Set(names).size, names.length, "Duplicate tool name");
  for (const tool of tools) {
    assert.equal(tool.annotations?.readOnlyHint, true, "Tool must be read-only");
    assert.equal(tool.annotations?.destructiveHint, false, "Tool must be non-destructive");
    assert.equal(tool.inputSchema?.type, "object", "Missing input schema");
    assert.equal(tool.outputSchema?.type, "object", "Missing output schema");
    assert.ok(tool.description?.length > 15, "Missing tool description");
  }
  assert.ok(!JSON.stringify(tools).includes('"additionalProperties":{}'), "Non-portable tool schema");
}

/** Test a default endpoint, plus isolated toolset connections when extended is set. */
export async function checkMcp({ createTransport, expected, extended = false, timeoutMs = 30_000, delayMs = 0 }) {
  assert.ok(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 600_000, "Timeout must be 1–600000 ms");
  assert.ok(Number.isInteger(delayMs) && delayMs >= 0 && delayMs <= 60_000, "Request delay must be 0–60000 ms");
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(new Error("MCP check deadline exceeded")), timeoutMs);
  const clients = [];
  const transports = [];
  const options = { signal: abort.signal, timeout: Math.min(timeoutMs, 15_000) };
  let calls = 0;
  let stage = "initialize";
  const request = async (label, action) => {
    stage = label;
    if (delayMs) await delay(delayMs, undefined, { signal: abort.signal });
    abort.signal.throwIfAborted();
    calls += 1;
    return action();
  };
  const connect = async (toolsets) => {
    const client = new Client({ name: "ireland-mcp-contract-check", version: "1.0.0" });
    clients.push(client);
    const transport = createTransport(toolsets);
    transports.push(transport);
    await request("initialize", () => client.connect(transport, options));
    assert.deepEqual(client.getServerVersion(), { name: expected.name, version: expected.version }, "Server identity differs from source");
    for (const capability of ["tools", "resources", "prompts"]) {
      assert.ok(client.getServerCapabilities()?.[capability], "Missing server capability");
    }
    assert.ok(client.getInstructions()?.includes("ireland_call"), "Missing server instructions");
    return client;
  };
  try {
    const client = await connect();
    const tools = (await request("tools/list", () => client.listTools({}, options))).tools;
    verifyTools(tools, expected.defaultTools);
    const call = async (name, args = {}, error = false) => bodyOf(await request(name, () => client.callTool({ name, arguments: args }, undefined, options)), error);
    const about = await call("ireland_about");
    assert.equal(about.name, expected.name);
    assert.equal(about.version, expected.version);
    assert.deepEqual(sorted(about.sources.map((source) => source.id)), sorted(expected.modules.map((module) => module.id)));
    const catalogue = await call("ireland_catalogue");
    const sources = catalogue.domains.flatMap((domain) => domain.sources);
    assert.deepEqual(sorted(sources.map((source) => source.id)), sorted(expected.modules.map((module) => module.id)));
    for (const module of expected.modules) {
      assert.deepEqual(sorted(sources.find((source) => source.id === module.id).operations), sorted(module.operations), "Catalogue operations differ from registry");
    }
    const descriptions = extended ? expected.operations : [expected.operations.find((operation) => operation.source === "cso") ?? expected.operations[0]];
    for (const operation of descriptions) {
      assert.ok(operation, "Registry has no operations");
      const description = await call("ireland_describe", { source: operation.source, operation: operation.operation });
      assert.equal(description.source, operation.source);
      assert.equal(description.operation, operation.operation);
      assert.deepEqual(description.input_schema, operation.schema, "Operation schema differs from registry");
      assert.deepEqual(description.example, operation.example, "Operation example differs from registry");
      assert.deepEqual(description.call, { tool: "ireland_call", arguments: { source: operation.source, operation: operation.operation, args: operation.example } });
    }
    const missing = await call("ireland_describe", { source: "cso", operation: "contract_check_missing_operation" }, true);
    assert.equal(missing.error?.code, "NOT_FOUND", "Missing structured error code");
    assert.equal(typeof missing.error?.hint, "string", "Missing recovery hint");
    // Rejected arguments must not cause an upstream request.
    const invalid = await call("ireland_call", { source: "cso", operation: expected.operations.find((operation) => operation.source === "cso").operation, args: { contract_check_unknown_argument: true } }, true);
    assert.equal(invalid.error?.code, "BAD_ARGS", "Invalid arguments were not rejected");
    assert.equal(invalid.expected_schema?.type, "object", "Missing recovery schema");

    const resources = (await request("resources/list", () => client.listResources({}, options))).resources;
    assert.deepEqual(sorted(resources.map((resource) => resource.uri)), sorted(expected.modules.map((module) => `ireland://sources/${module.id}`)));
    const readResources = extended ? resources : [resources.find((resource) => resource.name === "cso")];
    for (const resource of readResources) {
      assert.ok(resource, "Missing source resource");
      const read = await request("resources/read", () => client.readResource({ uri: resource.uri }, options));
      assert.equal(read.contents.length, 1);
      const content = read.contents[0];
      assert.equal(content.uri, resource.uri);
      assert.equal(content.mimeType, "application/json");
      const doc = JSON.parse(content.text);
      const module = expected.modules.find((module) => module.id === doc.id);
      assert.ok(module, "Unknown source resource");
      assert.equal(doc.id, resource.name);
      assert.deepEqual(sorted(doc.operations.map((operation) => operation.name)), sorted(module.operations));
      for (const field of ["licence", "attribution", "coverage"]) assert.ok(typeof doc[field] === "string" && doc[field].length > 0, "Missing source evidence");
    }
    const prompts = (await request("prompts/list", () => client.listPrompts({}, options))).prompts;
    assert.deepEqual(sorted(prompts.map((prompt) => prompt.name)), sorted(expected.prompts));
    for (const prompt of prompts) {
      const args = Object.fromEntries((prompt.arguments ?? []).map((argument) => [argument.name, "Ireland"]));
      const result = await request("prompts/get", () => client.getPrompt({ name: prompt.name, arguments: args }, options));
      assert.ok(result.messages.length > 0 && result.messages.every((message) => message.role === "user" && message.content.type === "text" && message.content.text.length > 0), "Missing prompt content");
    }
    if (extended) {
      for (const toolsets of ["all", "cso"]) {
        const scoped = await connect(toolsets);
        const names = [...new Set([...expected.defaultTools, ...expected.operations.filter((operation) => toolsets === "all" || operation.source === toolsets).map((operation) => operation.operation)])];
        verifyTools((await request("tools/list", () => scoped.listTools({}, options))).tools, names);
      }
    }
    return { passed: true, proof: "native-mcp-metadata", server: { name: expected.name, version: expected.version }, sources: expected.sources, operations: expected.operations.length, tools: tools.length, resources: resources.length, prompts: prompts.length, descriptions: descriptions.length, toolsets: extended ? ["default", "all", "cso"] : ["default"], calls };
  } catch {
    // Do not print provider messages, endpoint credentials, arguments or result payloads.
    throw new Error(`MCP contract failed at ${stage}${abort.signal.aborted ? " (deadline)" : ""}.`);
  } finally {
    clearTimeout(timer);
    abort.abort();
    await Promise.allSettled(clients.map((client) => client.close()));
    await Promise.allSettled(transports.map((transport) => transport.close()));
  }
}

async function main(argv) {
  const { parseArgs } = await import("node:util");
  const { values } = parseArgs({ args: argv, options: { url: { type: "string" }, extended: { type: "boolean", default: false }, "timeout-ms": { type: "string" }, "delay-ms": { type: "string" } } });
  const endpoint = values.url ? new URL(values.url) : undefined;
  if (endpoint) {
    assert.ok(["http:", "https:"].includes(endpoint.protocol) && !endpoint.username && !endpoint.password && !endpoint.hash, "Use an HTTP MCP URL without credentials or fragments");
    assert.ok(!endpoint.searchParams.has("toolsets") && !/\/mcp\/x\//.test(endpoint.pathname), "Use the default MCP endpoint; --extended checks toolsets separately");
  }
  const [{ appModules, sourceModules }, { SERVER_NAME, SERVER_VERSION }, { PROMPTS }, { operationSchema, exampleArgs }] = await Promise.all([
    import("../dist/src/registry.js"), import("../dist/src/gateway/server.js"), import("../dist/src/counts.js"), import("../dist/src/gateway/catalogue.js")
  ]);
  const expected = contractFromRegistry({ ...appModules(), sourceModules, name: SERVER_NAME, version: SERVER_VERSION, prompts: PROMPTS, operationSchema, exampleArgs });
  const createTransport = (toolsets) => {
    if (endpoint) {
      const url = new URL(endpoint);
      if (toolsets) url.searchParams.set("toolsets", toolsets);
      return new StreamableHTTPClientTransport(url);
    }
    return new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL("../dist/src/cli.js", import.meta.url)), ...(toolsets ? [`--toolsets=${toolsets}`] : [])], env: { ...process.env, IRELAND_MCP_TOOLSETS: "" }, stderr: "ignore" });
  };
  console.log(JSON.stringify(await checkMcp({ createTransport, expected, extended: values.extended, timeoutMs: Number(values["timeout-ms"] ?? (values.extended ? 240_000 : 30_000)), delayMs: Number(values["delay-ms"] ?? (endpoint && values.extended ? 1500 : 0)) }), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error && error.message.startsWith("MCP contract failed at ") ? error.message : "MCP contract check failed. Check the target, build, metadata contract and deadline.");
    process.exitCode = 1;
  });
}
