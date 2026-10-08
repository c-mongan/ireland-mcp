import { ToolError } from "./errors.js";
import { instruments, SpanKind, withSpan } from "./otel.js";
import { sourceForUrl, type UpstreamBudgets } from "./upstreamBudget.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  retries?: number;
  /** Extra HTTP statuses to treat as transient, e.g. a source known to flap with 403 from cloud IPs. */
  retryStatuses?: readonly number[];
  maxBytes?: number;
  /** Label used in error messages instead of the raw URL (keeps keys out of errors). */
  label?: string;
}

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const USER_AGENT = "ireland-mcp/1.0 (+https://github.com/c-mongan/ireland-mcp)";
/** Gateway, timeout and overload statuses that usually clear on a second try. 501/505 and 4xx are not retried. */
const TRANSIENT_STATUSES = new Set([408, 500, 502, 503, 504]);
const BACKOFF_BASE_MS = 250;
const BACKOFF_CAP_MS = 2_000;

export interface RetryTiming {
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

/** Equal-jitter exponential backoff: attempt 0 waits 125-250ms, attempt 1 waits 250-500ms, capped at 2s. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt);
  return Math.round(ceiling / 2 + (ceiling / 2) * random());
}

export class HttpClient {
  constructor(
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
    private readonly budgets?: UpstreamBudgets,
    private readonly timing: RetryTiming = {}
  ) {}

  /** One CLIENT span per logical request; the URL is not recorded because queries can carry tool arguments. */
  async bytes(url: string, options: HttpOptions = {}): Promise<Uint8Array> {
    const source = sourceForUrl(url);
    const method = options.method ?? "GET";
    const attributes = {
      "ireland_mcp.source.id": source,
      "server.address": hostnameOf(url),
      "http.request.method": method
    };
    const started = performance.now();
    let errorType: string | undefined;
    try {
      return await withSpan(method, SpanKind.CLIENT, attributes, () =>
        this.budgets
          ? this.budgets.run(source, (timeoutMs) => this.withRetries(url, { ...options, timeoutMs: options.timeoutMs ?? timeoutMs }))
          : this.withRetries(url, options)
      );
    } catch (error) {
      errorType = error instanceof ToolError ? error.code : "_OTHER";
      throw error;
    } finally {
      instruments().clientDuration.record((performance.now() - started) / 1000, {
        ...attributes,
        ...(errorType ? { "error.type": errorType } : {})
      });
    }
  }

  private async withRetries(url: string, options: HttpOptions): Promise<Uint8Array> {
    const retries = options.retries ?? 1;
    const sleep = this.timing.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.once(url, options);
      } catch (error) {
        // Only transient failures are retried; 403s, 501s, bad payloads and size bounds fail fast.
        if (!(error instanceof TransientUpstreamError) || attempt >= retries) throw error;
        await sleep(backoffMs(attempt, this.timing.random));
      }
    }
  }

  async text(url: string, options: HttpOptions = {}): Promise<string> {
    return new TextDecoder("utf-8").decode(await this.bytes(url, options));
  }

  async json<T = unknown>(url: string, options: HttpOptions = {}): Promise<T> {
    const body = await this.text(url, { ...options, headers: { accept: "application/json", ...options.headers } });
    try {
      return JSON.parse(body) as T;
    } catch {
      throw new ToolError("UPSTREAM_DOWN", `${options.label ?? hostOf(url)} returned a response that was not valid JSON.`, { retryable: false });
    }
  }

  private async once(url: string, options: HttpOptions): Promise<Uint8Array> {
    const label = options.label ?? hostOf(url);
    const controller = new AbortController();
    const timedOut = () => new TransientUpstreamError(`${label} could not be reached or did not respond in time.`);
    // The timer covers headers and body, so a slow-dripping body cannot hang a tool call.
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: options.method ?? "GET",
          headers: { "user-agent": USER_AGENT, ...options.headers },
          ...(options.body !== undefined ? { body: options.body } : {}),
          signal: controller.signal
        });
      } catch {
        throw timedOut();
      }

      if (CALLER_ERROR_STATUSES.has(response.status)) {
        // The caller's arguments were rejected (bad column, invalid value, oversized query). This is
        // not an outage, so it is BAD_ARGS and never counts toward the source's circuit breaker.
        const reason = await upstreamReason(response);
        throw new ToolError("BAD_ARGS", `${label} rejected the request parameters (HTTP ${response.status})${reason ? `: ${reason}` : "."}`, {
          hint: "Fix the arguments (check field or column names, values and formats against the tool schema or the dataset's fields) and retry."
        });
      }
      if (!response.ok) await response.body?.cancel().catch(() => undefined);
      if (response.status === 404) throw new ToolError("NOT_FOUND", `${label} has no matching resource.`);
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after") ?? "60");
        throw new ToolError("RATE_LIMITED", `${label} is rate limiting requests.`, {
          retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : 60
        });
      }
      if (!response.ok) {
        const message = `${label} returned HTTP ${response.status}.`;
        const transient = TRANSIENT_STATUSES.has(response.status) || options.retryStatuses?.includes(response.status);
        if (transient) throw new TransientUpstreamError(message, response.status);
        throw new ToolError("UPSTREAM_DOWN", message, { hint: hintForStatus(response.status), retryable: false });
      }

      const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
      const tooLarge = () =>
        new ToolError("UPSTREAM_DOWN", `${label} response is larger than the ${maxBytes} byte bound.`, {
          hint: "Narrow the query (fewer dimensions, a smaller limit or a filter).",
          retryable: false
        });
      const declared = Number(response.headers.get("content-length") ?? "0");
      if (declared > maxBytes) {
        await response.body?.cancel().catch(() => undefined);
        throw tooLarge();
      }
      return await readBounded(response, maxBytes, controller, tooLarge, timedOut, label);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** 4xx statuses that mean "your request was wrong", not "the source is down". */
const CALLER_ERROR_STATUSES = new Set([400, 409, 413, 414, 422]);

function hintForStatus(status: number): string {
  if (status === 401 || status === 403)
    return `The upstream answered but refused access (HTTP ${status}); it may block this server's network or need credentials. This is not a timeout, and retrying soon is unlikely to help.`;
  if (status >= 500) return `The upstream answered with a server error (HTTP ${status}). Try again in a minute.`;
  return `The upstream answered with HTTP ${status}, which this server does not treat as a result. Retrying is unlikely to help.`;
}

/** Pulls a short, single-line reason out of an upstream error body (CKAN, ArcGIS, plain text). */
async function upstreamReason(response: Response): Promise<string> {
  let text: string;
  try {
    text = (await response.text()).slice(0, 4000);
  } catch {
    return "";
  }
  let reason = text;
  try {
    const body = JSON.parse(text) as Record<string, unknown>;
    reason = leaves(body.error ?? body.message ?? body).join("; ");
  } catch {
    // Not JSON: keep the text.
  }
  const flat = reason.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > 200 ? `${flat.slice(0, 199)}…` : flat;
}

/** "key: text" for each string leaf of an error object, skipping CKAN's internal __type. */
function leaves(value: unknown, key = ""): string[] {
  if (typeof value === "string") return [key ? `${key}: ${value}` : value];
  if (Array.isArray(value)) return value.flatMap((item) => leaves(item, key));
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) => (k === "__type" ? [] : leaves(v, /^\d+$/.test(k) ? key : k)));
  return [];
}

/** Network errors, timeouts and gateway-style statuses: worth one bounded, backed-off retry. */
class TransientUpstreamError extends ToolError {
  constructor(message: string, status?: number) {
    super("UPSTREAM_DOWN", message, status ? { hint: hintForStatus(status) } : {});
  }
}

/**
 * Streams the body, aborting as soon as it passes maxBytes. Reads are raced against the
 * abort signal so the deadline holds even if the body stream ignores aborts.
 */
async function readBounded(
  response: Response,
  maxBytes: number,
  controller: AbortController,
  tooLarge: () => ToolError,
  timedOut: () => ToolError,
  label: string
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const aborted = new Promise<never>((_resolve, reject) => {
    const fail = () => reject(timedOut());
    if (controller.signal.aborted) fail();
    else controller.signal.addEventListener("abort", fail, { once: true });
  });
  aborted.catch(() => undefined);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      let next: ReadableStreamReadResult<Uint8Array>;
      try {
        next = await Promise.race([reader.read(), aborted]);
      } catch (error) {
        if (error instanceof ToolError) throw error;
        throw new TransientUpstreamError(`${label} failed while sending its response.`);
      }
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        controller.abort();
        throw tooLarge();
      }
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "upstream";
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "upstream";
  }
}
