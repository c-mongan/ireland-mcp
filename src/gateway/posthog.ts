import type { ToolCallEvent } from "./telemetry.js";
import { PACKAGED_RELEASE } from "./release.js";

const HOSTS = new Set(["https://eu.i.posthog.com", "https://us.i.posthog.com"]);
const ERROR_CODES = new Set(["UPSTREAM_DOWN", "NOT_FOUND", "BAD_ARGS", "RATE_LIMITED", "NOT_CONFIGURED"]);
const MAX_QUEUE = 50;
const MAX_DURATION = 120_000;
const FLUSH_BUDGET_MS = 500;

type Properties = Record<string, string | number | boolean>;
interface CaptureEvent { event: string; distinct_id: string; properties: Properties; }
export interface DeliveryDiagnostics {
  type: "posthog_delivery";
  attempted_count: number;
  http_accepted_count: number;
  dropped_http_count: number;
  dropped_network_count: number;
  dropped_timeout_count: number;
  dropped_queue_full_count: number;
}
interface Options {
  operations: ReadonlyMap<string, ReadonlySet<string>>;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  /** Immutable package provenance; never taken from caller/request data or runtime environment. */
  release?: string;
  onDelivery?: (diagnostic: DeliveryDiagnostics) => void;
}

export function validatedRelease(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{7,40}$/.test(value) ? value : undefined;
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
  const release = validatedRelease(options.release ?? PACKAGED_RELEASE);
  const report = options.onDelivery ?? ((diagnostic: DeliveryDiagnostics) => console.warn(JSON.stringify(diagnostic)));
  let queueFullDrops = 0;
  let queue: CaptureEvent[] = [];
  let active: Promise<void> | undefined;
  function config() {
    const host = env.IRELAND_MCP_POSTHOG_HOST;
    const token = env.IRELAND_MCP_POSTHOG_KEY;
    if (env.IRELAND_MCP_TELEMETRY === "off" || env.IRELAND_MCP_POSTHOG_ENABLED !== "true" || !host || !HOSTS.has(host) || !token) return;
    return { host, token };
  }
  function capture(event: ToolCallEvent): void {
    if (!config()) return;
    if (queue.length >= MAX_QUEUE) { queueFullDrops = Math.min(1_000_000, queueFullDrops + 1); return; }
    queue.push({
      event: "ireland_mcp_tool_completed",
      distinct_id: "ireland-mcp-service-aggregate",
      properties: {
        ...safeToolProperties(event, options.operations),
        ...(release ? { release_commit: release } : {}),
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
    const diagnostics: DeliveryDiagnostics = {
      type: "posthog_delivery", attempted_count: 0, http_accepted_count: 0,
      dropped_http_count: 0, dropped_network_count: 0, dropped_timeout_count: 0, dropped_queue_full_count: 0
    };
    // At most two batches per request lifecycle, even under continuous traffic.
    for (let batch = 0; batch < 2 && queue.length; batch++) {
      const current = config();
      if (!current) { queue = []; queueFullDrops = 0; return; }
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const events = queue.splice(0, MAX_QUEUE);
      diagnostics.attempted_count += events.length;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        // Race also bounds a faulty transport that ignores AbortSignal.
        const result = await Promise.race([
          Promise.resolve().then(() => send(`${current.host}/batch/`, {
            method: "POST", redirect: "error", credentials: "omit", signal: controller.signal,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ api_key: current.token, batch: events })
          })).then((response) => {
            void response.body?.cancel().catch(() => undefined);
            return response.ok ? "http_accepted" as const : "http_failure" as const;
          }),
          new Promise<"timeout">((resolve) => { timer = setTimeout(() => { resolve("timeout"); controller.abort(); }, Math.min(250, remaining)); })
        ]);
        if (result === "http_accepted") diagnostics.http_accepted_count += events.length;
        else if (result === "http_failure") diagnostics.dropped_http_count += events.length;
        else diagnostics.dropped_timeout_count += events.length;
      } catch {
        diagnostics.dropped_network_count += events.length;
        // No error messages, retries, or requeue. Metrics cannot fail MCP requests.
      } finally {
        if (timer) clearTimeout(timer);
        controller.abort();
      }
    }
    diagnostics.dropped_queue_full_count = queueFullDrops;
    queueFullDrops = 0;
    const lost = diagnostics.dropped_http_count + diagnostics.dropped_network_count + diagnostics.dropped_timeout_count + diagnostics.dropped_queue_full_count;
    if (lost && config()) {
      // At most one local fixed-schema summary per flush; never recurse into PostHog capture.
      try { report(diagnostics); } catch { /* Diagnostics cannot fail the request. */ }
    }
  }
  function flush(): Promise<void> {
    if (!config()) { queue = []; queueFullDrops = 0; return Promise.resolve(); }
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
