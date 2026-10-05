#!/usr/bin/env node
// Local Streamable HTTP server without Azure Functions Core Tools: POST /mcp, GET /healthz, and web/ as static files.
// Usage: npm run build && npm run dev:http   (PORT defaults to 7071; HOST to 127.0.0.1)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext } from "../dist/src/gateway/context.js";
import { handleMcpHttp } from "../dist/src/gateway/httpHandler.js";
import { limitFromEnv, RateLimiter } from "../dist/src/gateway/rateLimit.js";
import { consoleSink } from "../dist/src/gateway/telemetry.js";
import { createAppServer } from "../dist/src/registry.js";
import { toolsetsFromUrl } from "../dist/src/gateway/toolsets.js";
import { healthHandler } from "../dist/src/functions/healthz.js";

const port = Number(process.env.PORT ?? 7071);
const host = process.env.HOST ?? "127.0.0.1";
const context = createContext();
const rateLimiter = new RateLimiter(limitFromEnv(process.env.RATE_LIMIT_PER_MINUTE));
const webRoot = fileURLToPath(new URL("../web/", import.meta.url));
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".json": "application/json" };

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  try {
    if (url.pathname === "/mcp" || /^\/mcp\/x\/[^/]+\/?$/.test(url.pathname)) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = req.method === "POST" ? Buffer.concat(chunks).toString("utf8") : undefined;
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      headers.set("x-forwarded-for", req.socket.remoteAddress ?? "local");
      const response = await handleMcpHttp(new Request(url, { method: req.method, headers, ...(body !== undefined ? { body } : {}) }), {
        createServer: (request) => createAppServer(context, consoleSink, toolsetsFromUrl(request.url)),
        rateLimiter
      });
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(await response.text());
      return;
    }
    if (url.pathname === "/healthz") {
      const h = await healthHandler();
      res.writeHead(h.status ?? 200, { "content-type": "application/json", ...h.headers });
      res.end(JSON.stringify(h.jsonBody));
      return;
    }
    const path = normalize(join(webRoot, url.pathname === "/" ? "index.html" : url.pathname));
    if (!path.startsWith(webRoot)) throw Object.assign(new Error("not found"), { code: "ENOENT" });
    const file = await readFile(path);
    res.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" });
    res.end(file);
  } catch (error) {
    res.writeHead(error?.code === "ENOENT" ? 404 : 500, { "content-type": "text/plain" });
    res.end(error?.code === "ENOENT" ? "Not found" : "Server error");
  }
}).listen(port, host, () => console.log(`Ireland MCP dev server: http://localhost:${port}/ (MCP at /mcp)`));
