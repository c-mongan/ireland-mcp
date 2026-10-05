import { ToolError } from "./errors.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  retries?: number;
  maxBytes?: number;
  /** Label used in error messages instead of the raw URL (keeps keys out of errors). */
  label?: string;
}

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const USER_AGENT = "ireland-mcp/1.0 (+https://github.com/c-mongan/ireland-mcp)";

export class HttpClient {
  constructor(private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init)) {}

  async bytes(url: string, options: HttpOptions = {}): Promise<Uint8Array> {
    const retries = options.retries ?? 1;
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await this.once(url, options);
      } catch (error) {
        lastError = error;
        if (error instanceof ResponseTooLargeError) throw error;
        if (error instanceof ToolError && error.code !== "UPSTREAM_DOWN") throw error;
      }
    }
    throw lastError;
  }

  async text(url: string, options: HttpOptions = {}): Promise<string> {
    return new TextDecoder("utf-8").decode(await this.bytes(url, options));
  }

  async json<T = unknown>(url: string, options: HttpOptions = {}): Promise<T> {
    const body = await this.text(url, { ...options, headers: { accept: "application/json", ...options.headers } });
    try {
      return JSON.parse(body) as T;
    } catch {
      throw new ToolError("UPSTREAM_DOWN", `${options.label ?? hostOf(url)} returned a response that was not valid JSON.`);
    }
  }

  private async once(url: string, options: HttpOptions): Promise<Uint8Array> {
    const label = options.label ?? hostOf(url);
    const controller = new AbortController();
    const timedOut = () => new ToolError("UPSTREAM_DOWN", `${label} could not be reached or did not respond in time.`);
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

      if (!response.ok) await response.body?.cancel().catch(() => undefined);
      if (response.status === 404) throw new ToolError("NOT_FOUND", `${label} has no matching resource.`);
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after") ?? "60");
        throw new ToolError("RATE_LIMITED", `${label} is rate limiting requests.`, {
          retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : 60
        });
      }
      if (response.status === 400) throw new ToolError("BAD_ARGS", `${label} rejected the request parameters.`);
      if (!response.ok) throw new ToolError("UPSTREAM_DOWN", `${label} returned HTTP ${response.status}.`);

      const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
      const tooLarge = () =>
        new ResponseTooLargeError(`${label} response is larger than the ${maxBytes} byte bound.`, {
          hint: "Narrow the query (fewer dimensions, a smaller limit or a filter)."
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

/** Marks a size-bound failure: retrying would only download the same oversized body again. */
class ResponseTooLargeError extends ToolError {
  constructor(message: string, options: { hint?: string }) {
    super("UPSTREAM_DOWN", message, options);
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
        throw new ToolError("UPSTREAM_DOWN", `${label} failed while sending its response.`);
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

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "upstream";
  }
}
