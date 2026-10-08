import { HttpRequest, type HttpResponseInit } from "@azure/functions";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SECURITY_HEADERS } from "../gateway/securityHeaders.js";
import { healthHandler } from "./healthz.js";
import { mcpHandler } from "./mcp.js";

const mocks = vi.hoisted(() => ({
  createAppServer: vi.fn(),
  check: vi.fn()
}));

vi.mock("../registry.js", () => ({
  createAppServer: mocks.createAppServer,
  sourceModules: [{ info: { id: "demo" } }]
}));
vi.mock("../gateway/otel.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../gateway/otel.js")>(),
  initTelemetry: async () => undefined
}));
vi.mock("../gateway/deepHealth.js", () => ({ sharedDeepHealth: () => ({ check: mocks.check }) }));

const ORIGIN = "https://irishopendata.com";
const request = (body: string, headers: Record<string, string> = {}, method = "POST", path = "/mcp") =>
  new HttpRequest({
    method,
    url: `https://mcp.irishopendata.com${path}`,
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    ...(method === "POST" ? { body: { string: body } } : {})
  });
const expectSecurity = (response: HttpResponseInit) => {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(headers.get(name)).toBe(value);
  expect(headers.get("strict-transport-security")).toBe("max-age=31536000");
  return headers;
};
const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });

describe("site alias route precedence", () => {
  it.each(["/healthz", "/healthz?deep=1&x=1"])("redirects www%s before running health checks", async (path) => {
    const response = await healthHandler(new HttpRequest({ method: "GET", url: `https://www.irishopendata.com${path}` }));
    expect(response.status).toBe(301);
    expect(expectSecurity(response).get("location")).toBe(`https://irishopendata.com${path}`);
    expect(mocks.check).not.toHaveBeenCalled();
  });

  it.each([
    ["GET", "/mcp?x=1"],
    ["POST", "/mcp/x/cso?toolsets=irish-rail"]
  ])("redirects www %s %s before running MCP", async (method, path) => {
    const req = new HttpRequest({
      method,
      url: `https://www.irishopendata.com${path}`,
      headers: { "content-length": "1000000" },
      ...(method === "POST" ? { body: { string: body } } : {})
    });
    const read = vi.spyOn(req, "text");
    const response = await mcpHandler(req);
    expect(response.status).toBe(301);
    expect(expectSecurity(response).get("location")).toBe(`https://irishopendata.com${path}`);
    expect(mocks.createAppServer).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it.each(["mcp.irishopendata.com", "func-ireland-mcp-aofsjpwgy4hva.azurewebsites.net", "irishopendata.com"])(
    "preserves explicit routes on %s",
    async (host) => {
      const health = await healthHandler(new HttpRequest({ method: "GET", url: `https://${host}/healthz` }));
      expect(health.status).toBe(200);
      expect(new Headers(health.headers).get("location")).toBeNull();
      const mcp = await mcpHandler(new HttpRequest({ method: "GET", url: `https://${host}/mcp?x=1` }));
      expect(mcp.status).toBe(405);
      expect(new Headers(mcp.headers).get("location")).toBeNull();
    }
  );
});

beforeEach(() => {
  mocks.createAppServer.mockReset().mockImplementation(() => {
    const server = new McpServer({ name: "demo", version: "1" });
    server.registerTool("demo", {}, async () => ({ content: [] }));
    return server;
  });
  afterEach(() => vi.restoreAllMocks());
  mocks.check.mockReset().mockResolvedValue({ status: "ok", sources: [] });
});

describe("Function MCP responses", () => {
  it.each(["/mcp", "/mcp/x/cso"])("preserves headers through the Azure adapter on %s", async (path) => {
    const response = await mcpHandler(request(body, { origin: ORIGIN }, "POST", path));
    expect(response.status).toBe(200);
    expect(expectSecurity(response).get("access-control-allow-origin")).toBe(ORIGIN);
    expect(JSON.parse(response.body as string).result.tools).toEqual([expect.objectContaining({ name: "demo" })]);
  });

  it.each(["declared", "actual"])("adds CORS and security headers to the %s Function body limit", async (kind) => {
    const response = await mcpHandler(request(kind === "actual" ? "x".repeat(256 * 1024 + 1) : body, {
      origin: ORIGIN,
      ...(kind === "declared" ? { "content-length": String(256 * 1024 + 1) } : {})
    }));
    expect(response.status).toBe(413);
    const headers = expectSecurity(response);
    expect(headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(headers.get("vary")).toBe("Origin");
    expect(response.jsonBody).toEqual({ error: "Request body too large." });
    expect(mocks.createAppServer).not.toHaveBeenCalled();
  });

  it.each(["POST", "OPTIONS"])("rejects a disallowed %s origin before the body guard or body read", async (method) => {
    const req = request(body, { origin: "https://evil.example", "content-length": "1000000" }, method);
    const read = vi.spyOn(req, "text");
    const response = await mcpHandler(req);
    expect(response.status).toBe(403);
    expect(expectSecurity(response).get("access-control-allow-origin")).toBeNull();
    expect(read).not.toHaveBeenCalled();
    expect(mocks.createAppServer).not.toHaveBeenCalled();
  });

  it("keeps no-Origin server clients working", async () => {
    const response = await mcpHandler(request(body));
    expect(response.status).toBe(200);
    expect(expectSecurity(response).get("access-control-allow-origin")).toBe("*");
  });

  it.each([
    ["OPTIONS", 204],
    ["GET", 405],
    ["DELETE", 405]
  ])("covers %s responses", async (method, status) => {
    const response = await mcpHandler(request("", { origin: ORIGIN }, method));
    expect(response.status).toBe(status);
    expect(expectSecurity(response).get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("returns a sanitized, secured error if the Function body read fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const req = request(body, { origin: ORIGIN });
    vi.spyOn(req, "text").mockRejectedValue(new Error("private body detail"));
    const response = await mcpHandler(req);
    expect(response.status).toBe(500);
    expect(expectSecurity(response).get("access-control-allow-origin")).toBe(ORIGIN);
    expect(JSON.stringify(response.jsonBody)).not.toContain("private body detail");
    expect(log).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ type: "handler_error", handler: "mcpHandler", errorType: "Error" }));
    expect(JSON.stringify(log.mock.calls)).not.toContain("private body detail");
  });
});

describe("Function health responses", () => {
  it("supports HEAD with GET's status and headers but no body", async () => {
    const get = await healthHandler(new HttpRequest({ method: "GET", url: "https://mcp.irishopendata.com/healthz" }));
    const head = await healthHandler(new HttpRequest({ method: "HEAD", url: "https://mcp.irishopendata.com/healthz" }));
    expect(head.status).toBe(get.status);
    expect(head.headers).toEqual(get.headers);
    expect(head.jsonBody).toBeUndefined();
    expect(head.body).toBeUndefined();
  });

  it("redirects HEAD on the www alias with no body", async () => {
    const response = await healthHandler(new HttpRequest({ method: "HEAD", url: "https://www.irishopendata.com/healthz?x=1" }));
    expect(response.status).toBe(301);
    expect(expectSecurity(response).get("location")).toBe("https://irishopendata.com/healthz?x=1");
    expect(response.jsonBody).toBeUndefined();
    expect(response.body).toBeUndefined();
  });

  it.each([200, 500])("supports deep HEAD with GET's %s status and headers but no body", async (status) => {
    if (status === 500) mocks.check.mockRejectedValue(new Error("private upstream detail"));
    const url = "https://mcp.irishopendata.com/healthz?deep=1";
    const get = await healthHandler(new HttpRequest({ method: "GET", url }));
    const head = await healthHandler(new HttpRequest({ method: "HEAD", url }));
    expect(head.status).toBe(status);
    expect(head.headers).toEqual(get.headers);
    expect(head.jsonBody).toBeUndefined();
    expect(head.body).toBeUndefined();
  });

  it("keeps liveness uncached", async () => {
    const response = await healthHandler();
    expect(response.status).toBe(200);
    const headers = expectSecurity(response);
    expect(headers.get("cache-control")).toBe("no-store");
    expect(headers.get("access-control-allow-origin")).toBeNull();
    expect(response.jsonBody).toMatchObject({ status: "ok", sources: ["demo"] });
    expect(mocks.check).not.toHaveBeenCalled();
  });

  it.each(["1", "true"])("preserves deep health's public cache and CORS for deep=%s", async (deep) => {
    const response = await healthHandler({ query: new URLSearchParams({ deep }) });
    expect(response.status).toBe(200);
    const headers = expectSecurity(response);
    expect(headers.get("cache-control")).toBe("public, max-age=60");
    expect(headers.get("access-control-allow-origin")).toBe("*");
    expect(mocks.check).toHaveBeenCalledOnce();
  });

  it("does not cache a secured deep health failure", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.check.mockRejectedValue(new Error("private upstream detail"));
    const response = await healthHandler({ query: new URLSearchParams({ deep: "1" }) });
    expect(response.status).toBe(500);
    const headers = expectSecurity(response);
    expect(headers.get("cache-control")).toBe("no-store");
    expect(headers.get("access-control-allow-origin")).toBe("*");
    expect(response.jsonBody).toEqual({ error: "Health check failed." });
    expect(log).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ type: "handler_error", handler: "healthResponse", errorType: "Error" }));
    expect(JSON.stringify(log.mock.calls)).not.toContain("private upstream detail");
  });
});
