import type { ToolCallEvent } from "./telemetry.js";

const HOSTS = new Set(["https://eu.i.posthog.com", "https://us.i.posthog.com"]);
const ERROR_CODES = new Set(["UPSTREAM_DOWN", "NOT_FOUND", "BAD_ARGS", "RATE_LIMITED", "NOT_CONFIGURED"]);
const MAX_QUEUE = 50;
const MAX_DURATION = 120_000;
const FLUSH_BUDGET_MS = 500;

type Properties = Record<string, string | number | boolean>;
interface CaptureEvent { event: string; distinct_id: string; properties: Properties; }
interface Options {
  operations: ReadonlyMap<string, ReadonlySet<string>>;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
}

/** Only deployment-owned labels can cross this boundary. Never spread the input event. */
export function safeToolProperties(event: ToolCallEvent, operations: Options["operations"]): Properties {
  const knownSource = operations.has(event.source);
  const properties: Properties = {
    source: knownSource ? event.source : "_OTHER",
    operation: knownSource && operations.get(event.source)?.has(event.tool) ? event.tool : "_OTHER",
    outcome: event.outcome === "ok" ? "ok" : "error",
    duration_ms: Number.isFinite(event.durationMs) ? Math.max(0, Math.min(MAX_DURATION, Math.round(event.durationMs))) : 0
  };
  if (typeof event.cached === "boolean") properties.cached = event.cached;
  if (typeof event.stale === "boolean") properties.stale = event.stale;
  if (event.errorCode !== undefined) properties.error_code = ERROR_CODES.has(event.errorCode) ? event.errorCode : "_OTHER";
  return properties;
}

/** Small, loss-tolerant capture client. Capture never starts or waits for network work. */
export function createPostHogCapture(options: Options) {
  const env = options.env ?? process.env;
  const send = options.fetch ?? globalThis.fetch;
  let queue: CaptureEvent[] = [];
  let active: Promise<void> | undefined;
  function config() {
    const host = env.IRELAND_MCP_POSTHOG_HOST;
    const token = env.IRELAND_MCP_POSTHOG_KEY;
    if (env.IRELAND_MCP_TELEMETRY === "off" || env.IRELAND_MCP_POSTHOG_ENABLED !== "true" || !host || !HOSTS.has(host) || !token) return;
    return { host, token };
  }
  function capture(event: ToolCallEvent): void {
    if (!config() || queue.length >= MAX_QUEUE) return;
    queue.push({
      event: "ireland_mcp_tool_completed",
      distinct_id: "ireland-mcp-service-aggregate",
      properties: {
        ...safeToolProperties(event, options.operations),
        ...(env.IRELAND_MCP_RELEASE && /^[a-f0-9]{7,40}$/.test(env.IRELAND_MCP_RELEASE) ? { release_commit: env.IRELAND_MCP_RELEASE } : {}),
        schema_version: 1,
        surface: "mcp",
        $process_person_profile: false,
        $geoip_disable: true,
        $ip: "0.0.0.0"
      }
    });
  }
  async function drain(): Promise<void> {
    const deadline = Date.now() + FLUSH_BUDGET_MS;
    // At most two batches per request lifecycle, even under continuous traffic.
    for (let batch = 0; batch < 2 && queue.length; batch++) {
      const current = config();
      if (!current) { queue = []; return; }
      const remaining = deadline - Date.now();
      if (remaining <= 0) return;
      const events = queue.splice(0, MAX_QUEUE);
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        // Race also bounds a faulty transport that ignores AbortSignal.
        await Promise.race([
          Promise.resolve().then(() => send(`${current.host}/batch/`, {
            method: "POST", redirect: "error", credentials: "omit", signal: controller.signal,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ api_key: current.token, batch: events })
          })).then((response) => { void response.body?.cancel().catch(() => undefined); }),
          new Promise<void>((resolve) => { timer = setTimeout(() => { controller.abort(); resolve(); }, Math.min(250, remaining)); })
        ]);
      } catch {
        // No error messages, retries, or requeue. Metrics cannot fail MCP requests.
      } finally {
        if (timer) clearTimeout(timer);
        controller.abort();
      }
    }
  }
  function flush(): Promise<void> {
    if (!config()) { queue = []; return Promise.resolve(); }
    if (!active) active = drain().catch(() => undefined).finally(() => { active = undefined; });
    return active;
  }
  return { capture, flush };
}

let deployedCapture: ReturnType<typeof createPostHogCapture> | undefined;
/** The Azure entry point supplies its actual registry, without an import cycle. */
export function configurePostHog(operations: Options["operations"]): void {
  deployedCapture ??= createPostHogCapture({ operations });
}
export function capturePostHog(event: ToolCallEvent): void { deployedCapture?.capture(event); }
export function flushPostHog(): Promise<void> { return deployedCapture?.flush() ?? Promise.resolve(); }
