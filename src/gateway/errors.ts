export type ErrorCode = "UPSTREAM_DOWN" | "NOT_FOUND" | "BAD_ARGS" | "RATE_LIMITED" | "NOT_CONFIGURED";

/** Transport evidence only; handler, schema and payload errors do not carry this marker. */
export interface UpstreamFailure {
  kind: "timeout" | "network" | "http";
  attempts: number;
  timeout_ms?: number;
  status?: number;
}

const DEFAULT_HINTS: Record<ErrorCode, string> = {
  UPSTREAM_DOWN: "The upstream service did not respond. Try again in a minute.",
  NOT_FOUND: "Nothing matched. Check the identifier or try a search tool first.",
  BAD_ARGS: "Check the tool arguments against its input schema.",
  RATE_LIMITED: "Too many requests. Wait before retrying.",
  NOT_CONFIGURED: "This source needs server configuration that is not present on this deployment."
};

export class ToolError extends Error {
  readonly code: ErrorCode;
  readonly hint: string;
  /** Internal classification for retries, circuit breakers and stale fallback. */
  readonly retryable: boolean;
  readonly retryAfterSeconds?: number;
  readonly upstreamFailure?: UpstreamFailure;

  constructor(code: ErrorCode, message: string, options: { hint?: string; retryAfterSeconds?: number; retryable?: boolean; upstreamFailure?: UpstreamFailure } = {}) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.retryable = options.retryable ?? (code === "UPSTREAM_DOWN" || code === "RATE_LIMITED");
    this.hint = options.hint ?? DEFAULT_HINTS[code];
    if (options.retryAfterSeconds !== undefined) this.retryAfterSeconds = options.retryAfterSeconds;
    if (options.upstreamFailure) this.upstreamFailure = options.upstreamFailure;
  }

  toJSON(): { error: { code: ErrorCode; message: string; hint: string; retry_after_seconds?: number; upstream_failure?: UpstreamFailure } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        hint: this.hint,
        ...(this.upstreamFailure ? { upstream_failure: this.upstreamFailure } : {}),
        ...(this.retryAfterSeconds !== undefined ? { retry_after_seconds: this.retryAfterSeconds } : {})
      }
    };
  }
}

/** Converts any thrown value into a ToolError without leaking stack traces or internals. */
export function toToolError(error: unknown): ToolError {
  if (error instanceof ToolError) return error;
  if (error instanceof Error && error.name === "ZodError") {
    return new ToolError("BAD_ARGS", "Invalid arguments.");
  }
  return new ToolError("UPSTREAM_DOWN", "Unexpected failure while calling the upstream source.");
}
