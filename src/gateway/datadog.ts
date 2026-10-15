import { context, type Attributes } from "@opentelemetry/api";
import type { Resource } from "@opentelemetry/resources";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-base";

type Env = Record<string, string | undefined>;
const SITES = new Set(["datadoghq.com", "datadoghq.eu", "us3.datadoghq.com", "us5.datadoghq.com", "ap1.datadoghq.com", "ap2.datadoghq.com", "uk1.datadoghq.com"]);

/** Opt-in exporter settings. Only the header contains the key, never resource attributes. */
export function datadogConfig(env: Env) {
  if (env.IRELAND_MCP_DATADOG !== "on" || !env.DD_API_KEY) return undefined;
  const site = env.DD_SITE ?? "datadoghq.com";
  if (!SITES.has(site)) throw new Error("Unsupported Datadog site");
  let endpoint = `https://otlp.${site}`;
  if (env.IRELAND_MCP_DATADOG_OTLP_ENDPOINT) {
    const local = new URL(env.IRELAND_MCP_DATADOG_OTLP_ENDPOINT);
    if (local.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(local.hostname) || local.username || local.password || local.search || local.hash || local.pathname !== "/")
      throw new Error("Only a loopback OTLP override is allowed");
    endpoint = local.origin;
  }
  const resourceAttributes: Attributes = {
    "service.name": env.DD_SERVICE ?? "ireland-mcp",
    "deployment.environment.name": env.DD_ENV ?? "development",
    ...(env.DD_VERSION ? { "service.version": env.DD_VERSION } : {}),
    ...(env.IRELAND_MCP_AZURE_RESOURCE_ID ? { "cloud.provider": "azure", "cloud.platform": "azure.functions", "cloud.resource_id": env.IRELAND_MCP_AZURE_RESOURCE_ID } : {})
  };
  return { endpoint, headers: { "dd-api-key": env.DD_API_KEY, "dd-otlp-source": "serverless", compute_stats: "true" }, resourceAttributes };
}

export interface DatadogRuntime {
  spanProcessor: SpanProcessor;
  resource: Resource;
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}

let active: DatadogRuntime | undefined;
let emitError: ((event: string, attributes: Attributes) => void) | undefined;

/** Uses the existing manual spans. No HTTP, console, prompt or body auto-instrumentation. */
export async function createDatadogRuntime(env: Env): Promise<DatadogRuntime | undefined> {
  const config = datadogConfig(env);
  if (!config) return undefined;
  const [{ OTLPTraceExporter }, { OTLPLogExporter }, { BatchSpanProcessor }, { BatchLogRecordProcessor, LoggerProvider }, { resourceFromAttributes }] = await Promise.all([
    import("@opentelemetry/exporter-trace-otlp-http"),
    import("@opentelemetry/exporter-logs-otlp-http"),
    import("@opentelemetry/sdk-trace-base"),
    import("@opentelemetry/sdk-logs"),
    import("@opentelemetry/resources")
  ]);
  const batch = { maxQueueSize: 512, maxExportBatchSize: 32, scheduledDelayMillis: 1000, exportTimeoutMillis: 1000 };
  const resource = resourceFromAttributes(config.resourceAttributes);
  const traceBatch = new BatchSpanProcessor(new OTLPTraceExporter({ url: config.endpoint + "/v1/traces", headers: config.headers, timeoutMillis: 1000 }), batch);
  // Azure SDKs can create native spans even with automatic instrumentation off.
  // Export only this service's manual spans; leave Azure's own processors unchanged.
  const spanProcessor: SpanProcessor = {
    onStart(span, parentContext) { if (span.instrumentationScope.name === "ireland-mcp") traceBatch.onStart(span, parentContext); },
    onEnd(span) { if (span.instrumentationScope.name === "ireland-mcp") traceBatch.onEnd(span); },
    forceFlush: () => traceBatch.forceFlush(),
    shutdown: () => traceBatch.shutdown()
  };
  const logProcessor = new BatchLogRecordProcessor({ exporter: new OTLPLogExporter({ url: config.endpoint + "/v1/logs", headers: config.headers, timeoutMillis: 1000 }), ...batch });
  const loggerProvider = new LoggerProvider({ resource, processors: [logProcessor] });
  const logger = loggerProvider.getLogger("ireland-mcp");
  emitError = (event, attributes) => logger.emit({ context: context.active(), severityNumber: 17, severityText: "ERROR", body: event, attributes });
  active = {
    spanProcessor,
    resource,
    async forceFlush() { await Promise.allSettled([spanProcessor.forceFlush(), loggerProvider.forceFlush({ timeoutMillis: 1500 })]); },
    async shutdown() {
      emitError = undefined;
      await Promise.allSettled([spanProcessor.shutdown(), loggerProvider.shutdown()]);
      active = undefined;
    }
  };
  return active;
}

/** Explicit structured error events only. Does not intercept application or machine logs. */
export function recordDatadogError(event: string, attributes: Attributes): void {
  emitError?.(event, attributes);
}

/** Flush before Azure freezes the invocation. A telemetry failure must not fail a tool call. */
export async function flushDatadog(): Promise<void> {
  if (!active) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([active.forceFlush(), new Promise<void>((resolve) => { timer = setTimeout(resolve, 1500); })]);
  } catch {
    // Diagnostic export is best effort; the tool response remains authoritative.
  } finally {
    clearTimeout(timer);
  }
}
