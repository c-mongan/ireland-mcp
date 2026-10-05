import {
  context,
  metrics,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Histogram,
  type MeterProvider,
  type Span,
  type Tracer
} from "@opentelemetry/api";

const SCOPE = "ireland-mcp";

/** Tracer from the global provider; a no-op until a provider is registered. */
export function tracer(): Tracer {
  return trace.getTracer(SCOPE);
}

interface Instruments {
  operationDuration: Histogram;
  clientDuration: Histogram;
}

let instrumentsFor: { provider: MeterProvider; instruments: Instruments } | undefined;

/** The metrics API has no proxy provider, so instruments are re-created if the global provider changes. */
export function instruments(): Instruments {
  const provider = metrics.getMeterProvider();
  if (instrumentsFor?.provider !== provider) {
    const meter = provider.getMeter(SCOPE);
    instrumentsFor = {
      provider,
      instruments: {
        operationDuration: meter.createHistogram("mcp.server.operation.duration", {
          unit: "s",
          description: "Duration of MCP requests handled by the server."
        }),
        clientDuration: meter.createHistogram("http.client.request.duration", {
          unit: "s",
          description: "Duration of upstream HTTP requests, per source."
        })
      }
    };
  }
  return instrumentsFor.instruments;
}

/** Runs `fn` inside an active span and ends it, marking errors with error.type. */
export async function withSpan<T>(
  name: string,
  kind: SpanKind,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
  errorType: (error: unknown) => string = defaultErrorType
): Promise<T> {
  return tracer().startActiveSpan(name, { kind, attributes }, async (span) => {
    try {
      return await fn(span);
    } catch (error) {
      span.setAttribute("error.type", errorType(error));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

export function defaultErrorType(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
  return error instanceof Error ? error.name : "_OTHER";
}

export { context, SpanKind, SpanStatusCode, trace };

let started: Promise<boolean> | undefined;

/**
 * Starts the Azure Monitor distro when APPLICATIONINSIGHTS_CONNECTION_STRING is set.
 * The distro is imported lazily so local and CLI use never load it. Auto-instrumentation
 * is off: all spans come from this codebase, which keeps URLs, IPs and arguments out.
 */
export function initTelemetry(env: Record<string, string | undefined> = process.env): Promise<boolean> {
  started ??= start(env).catch((error: unknown) => {
    console.warn(`[ireland-mcp] telemetry disabled: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  });
  return started;
}

async function start(env: Record<string, string | undefined>): Promise<boolean> {
  if (!telemetryEnabled(env)) return false;
  env.OTEL_SERVICE_NAME ??= "ireland-mcp";
  const { useAzureMonitor } = await import("@azure/monitor-opentelemetry");
  const credential = usesEntraAuth(env) ? await managedIdentity(env) : undefined;
  useAzureMonitor(azureMonitorOptions(env, credential));
  return true;
}

export function telemetryEnabled(env: Record<string, string | undefined>): boolean {
  return Boolean(env.APPLICATIONINSIGHTS_CONNECTION_STRING) && env.IRELAND_MCP_OTEL !== "off";
}

function usesEntraAuth(env: Record<string, string | undefined>): boolean {
  return /authorization\s*=\s*aad/i.test(env.APPLICATIONINSIGHTS_AUTHENTICATION_STRING ?? "");
}

/** Distro options: no auto-instrumentation, no live/standard metrics, configurable sampling. */
export function azureMonitorOptions<C extends object>(env: Record<string, string | undefined>, credential?: C) {
  const ratio = Number(env.IRELAND_MCP_OTEL_SAMPLING_RATIO);
  return {
    azureMonitorExporterOptions: { connectionString: env.APPLICATIONINSIGHTS_CONNECTION_STRING, ...(credential ? { credential } : {}) },
    samplingRatio: Number.isFinite(ratio) && ratio > 0 && ratio <= 1 ? ratio : 1,
    enableLiveMetrics: false,
    enableStandardMetrics: false,
    enablePerformanceCounters: false,
    instrumentationOptions: {
      http: { enabled: false },
      azureSdk: { enabled: false },
      mongoDb: { enabled: false },
      mySql: { enabled: false },
      postgreSql: { enabled: false },
      redis: { enabled: false },
      redis4: { enabled: false },
      bunyan: { enabled: false },
      winston: { enabled: false },
      console: { enabled: false }
    }
  };
}

async function managedIdentity(env: Record<string, string | undefined>) {
  const { ManagedIdentityCredential } = await import("@azure/identity");
  const clientId = env.AZURE_CLIENT_ID;
  return clientId ? new ManagedIdentityCredential({ clientId }) : new ManagedIdentityCredential();
}
