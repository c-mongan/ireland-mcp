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
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: options.method ?? "GET",
        headers: { "user-agent": USER_AGENT, ...options.headers },
        ...(options.body !== undefined ? { body: options.body } : {}),
        signal: controller.signal
      });
    } catch {
      throw new ToolError("UPSTREAM_DOWN", `${label} could not be reached or did not respond in time.`);
    } finally {
      clearTimeout(timer);
    }

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
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > maxBytes) {
      throw new ToolError("UPSTREAM_DOWN", `${label} response is larger than the ${maxBytes} byte bound.`, {
        hint: "Narrow the query (fewer dimensions, a smaller limit or a filter)."
      });
    }
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      throw new ToolError("UPSTREAM_DOWN", `${label} response is larger than the ${maxBytes} byte bound.`, {
        hint: "Narrow the query (fewer dimensions, a smaller limit or a filter)."
      });
    }
    return buffer;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "upstream";
  }
}
