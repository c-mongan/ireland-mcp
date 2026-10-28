import { createServer, type Server } from "node:http";
import { Readable } from "node:stream";
import { execFile } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { appModules, sourceModules, createAppServer } from "../src/registry.js";
import { createContext } from "../src/gateway/context.js";
import { handleMcpHttp } from "../src/gateway/httpHandler.js";
import { toolsetsFromUrl } from "../src/gateway/toolsets.js";
import { SERVER_NAME, SERVER_VERSION } from "../src/gateway/server.js";
import { PROMPTS } from "../src/counts.js";
import { operationSchema, exampleArgs } from "../src/gateway/catalogue.js";
// @ts-expect-error Operational script has no generated declaration file.
import { checkMcp, contractFromRegistry } from "../scripts/check-mcp.mjs";

const expected = contractFromRegistry({ ...appModules(), sourceModules, name: SERVER_NAME, version: SERVER_VERSION, prompts: PROMPTS, operationSchema, exampleArgs });
const servers: Server[] = [];
const transports: StreamableHTTPClientTransport[] = [];
const context = createContext({ fetch: async () => { throw new Error("Metadata checks must not contact providers"); } });
type Mutator = (message: Record<string, unknown>) => void;

async function fixture(mutate?: Mutator, hang = false) {
  const server = createServer(async (req, res) => {
    if (hang) return;
    if (req.url === "/workflow-check") {
      try {
        const result = await checkMcp({ createTransport, expected, timeoutMs: 5000 });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (error) {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end(error instanceof Error ? error.message : "Contract check failed");
      }
      return;
    }
    const url = new URL(req.url ?? "/mcp", "http://localhost");
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(key, value);
    const request = new Request(url, { method: req.method, headers, ...(req.method === "POST" ? { body: Readable.toWeb(req) as ReadableStream<Uint8Array>, duplex: "half" } : {}) });
    const response = await handleMcpHttp(request, { createServer: (request) => createAppServer(context, undefined, toolsetsFromUrl(request.url)) });
    const text = await response.text();
    let output = text;
    if (mutate && text) {
      const message = JSON.parse(text) as Record<string, unknown>;
      mutate(message);
      output = JSON.stringify(message);
    }
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(output);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No fixture port");
  const endpoint = new URL(`http://127.0.0.1:${address.port}/mcp`);
  const createTransport = (toolsets?: string) => {
    const url = new URL(endpoint);
    if (toolsets) url.searchParams.set("toolsets", toolsets);
    const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { "x-ireland-mcp-synthetic": "1" } } });
    transports.push(transport);
    return transport;
  };
  return Object.assign(createTransport, { endpoint });
}

afterEach(async () => {
  await Promise.all(transports.splice(0).map((transport) => transport.close()));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); })));
});

describe("native MCP contract check", () => {
  it.each([false, true])("runs the actual deployment smoke against the registry (missing tool: %s)", async (missing) => {
    const createTransport = await fixture(missing ? (message) => {
      const result = message.result as { tools?: unknown[] } | undefined;
      result?.tools?.pop();
    } : undefined);
    const directory = mkdtempSync(join(tmpdir(), "ireland-deploy-smoke-"));
    try {
      const scripts = {
        azd: 'console.log(process.env.FIXTURE_ENDPOINT);',
        curl: 'console.log(JSON.stringify({release:process.env.GITHUB_SHA}));',
        npx: 'console.log(JSON.stringify({tools:JSON.parse(process.env.FIXTURE_TOOLS).map(name=>({name}))}));',
        npm: [
          'if(process.argv.slice(2).join(" ")!=="run check:mcp -- --url "+process.env.FIXTURE_ENDPOINT)process.exit(97);',
          'fetch(process.env.FIXTURE_CHECK_URL).then(async r=>{console.log(await r.text());process.exitCode=r.ok?0:1;}).catch(()=>{process.exitCode=98;});'
        ].join("\n")
      };
      for (const [name, script] of Object.entries(scripts)) {
        const path = join(directory, name);
        writeFileSync(path, "#!" + process.execPath + "\n" + script + "\n");
        chmodSync(path, 0o700);
      }
      const workflow = readFileSync(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
      const smoke = workflow.split("      - name: Smoke test the deployed endpoint\n        run: |\n")[1]?.split("\n      - ")[0];
      expect(smoke).toBeDefined();
      const command = smoke!.split("\n").map((line) => line.replace(/^ {10}/, "")).join("\n");
      // npm delegates to the real checker in this process, so this works before dist/ exists.
      // npx supplies the current tool set to reproduce the obsolete seven-tool gate without a download.
      const result = await promisify(execFile)("bash", ["-e", "-o", "pipefail", "-c", command], {
        cwd: directory,
        env: {
          ...process.env,
          PATH: directory + ":" + process.env.PATH,
          GITHUB_SHA: "a".repeat(40),
          FIXTURE_ENDPOINT: createTransport.endpoint.href,
          FIXTURE_CHECK_URL: new URL("/workflow-check", createTransport.endpoint).href,
          FIXTURE_TOOLS: JSON.stringify(expected.defaultTools)
        },
        timeout: 10_000
      }).then((output) => ({ status: 0, ...output }), (error: { code: number; stdout: string; stderr: string }) => ({
        status: error.code, stdout: error.stdout, stderr: error.stderr
      }));
      expect(result.status, result.stdout + result.stderr).toBe(missing ? 1 : 0);
      expect(result.stdout).toContain(missing ? "MCP contract failed at tools/list." : '"passed":true');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 15_000);

  it("checks real HTTP initialization, catalogue, errors, resource reads, prompts and isolated toolsets", async () => {
    const result = await checkMcp({ createTransport: await fixture(), expected, extended: true });
    expect(result).toMatchObject({ passed: true, proof: "native-mcp-metadata", sources: sourceModules.length, operations: expected.operations.length, descriptions: expected.operations.length, toolsets: ["default", "all", "cso"] });
  });

  it("rejects discovery with a missing tool", async () => {
    const createTransport = await fixture((message) => {
      const result = message.result as { tools?: unknown[] } | undefined;
      result?.tools?.pop();
    });
    await expect(checkMcp({ createTransport, expected })).rejects.toThrow("MCP contract failed at tools/list.");
  });

  it("rejects an error payload that claims to be successful", async () => {
    const createTransport = await fixture((message) => {
      const result = message.result as { isError?: boolean } | undefined;
      if (result?.isError) result.isError = false;
    });
    await expect(checkMcp({ createTransport, expected })).rejects.toThrow("MCP contract failed at ireland_describe.");
  });

  it("stops an unresponsive HTTP peer at its deadline and closes the transport", async () => {
    const createTransport = await fixture(undefined, true);
    const started = Date.now();
    await expect(checkMcp({ createTransport, expected, timeoutMs: 150 })).rejects.toThrow("deadline");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("rejects a structured error with the wrong recovery code", async () => {
    const createTransport = await fixture((message) => {
      const result = message.result as { isError?: boolean; content?: Array<{ type: string; text: string }> } | undefined;
      if (result?.isError && result.content?.[0]) {
        const body = JSON.parse(result.content[0].text) as { error: { code: string } };
        body.error.code = "INTERNAL_ERROR";
        result.content[0].text = JSON.stringify(body);
      }
    });
    await expect(checkMcp({ createTransport, expected })).rejects.toThrow("MCP contract failed at ireland_describe.");
  });
});
