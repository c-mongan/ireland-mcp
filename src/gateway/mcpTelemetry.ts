import type { Attributes, Span } from "@opentelemetry/api";
import { argumentNames, clientInfoFrom } from "./privacy.js";
import { context, instruments, SpanKind, SpanStatusCode, trace, tracer } from "./otel.js";

/** MCP methods recorded by name; anything else becomes "_OTHER" so attribute cardinality stays bounded. */
const KNOWN_METHODS = new Set([
  "initialize",
  "ping",
  "tools/list",
  "tools/call",
  "resources/list",
  "resources/read",
  "resources/templates/list",
  "resources/subscribe",
  "resources/unsubscribe",
  "prompts/list",
  "prompts/get",
  "completion/complete",
  "logging/setLevel",
  "notifications/initialized",
  "notifications/cancelled",
  "notifications/progress",
  "notifications/roots/list_changed"
]);

const TOOL_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
const ERROR_CODE = /^[A-Z_]{1,32}$/;

interface Operation {
  span: Span;
  id: string | number | undefined;
  started: number;
  metricAttributes: Attributes;
}

interface JsonRpcMessage {
  id?: string | number | null;
  method?: unknown;
  params?: unknown;
  result?: unknown;
  error?: { code?: unknown };
}

function messagesOf(bodyText: string): JsonRpcMessage[] {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.filter((m): m is JsonRpcMessage => !!m && typeof m === "object");
  } catch {
    return [];
  }
}

/**
 * Starts one SERVER span per JSON-RPC request following the OTel MCP semantic conventions:
 * name `{mcp.method.name} {gen_ai.tool.name}`. Only argument names and the client's
 * declared name/version are recorded; argument values, URLs and addresses never are.
 */
export function startMcpOperations(bodyText: string, headers: Headers): Operation[] {
  const sessionId = headers.get("mcp-session-id");
  const protocolVersion = headers.get("mcp-protocol-version");
  return messagesOf(bodyText)
    .filter((m) => typeof m.method === "string")
    .map((message) => {
      const method = KNOWN_METHODS.has(message.method as string) ? (message.method as string) : "_OTHER";
      const params = (message.params ?? {}) as { name?: unknown; arguments?: unknown };
      const tool = method === "tools/call" && typeof params.name === "string" && TOOL_NAME.test(params.name) ? params.name : undefined;
      const metricAttributes: Attributes = {
        "mcp.method.name": method,
        ...(tool ? { "gen_ai.tool.name": tool, "gen_ai.operation.name": "execute_tool" } : {}),
        ...(protocolVersion ? { "mcp.protocol.version": protocolVersion.slice(0, 32) } : {}),
        "network.transport": "tcp",
        "network.protocol.name": "http"
      };
      const attributes: Attributes = { ...metricAttributes };
      if (sessionId) attributes["mcp.session.id"] = sessionId.slice(0, 128);
      if (message.id !== undefined && message.id !== null) attributes["jsonrpc.request.id"] = String(message.id).slice(0, 64);
      if (tool) attributes["ireland_mcp.tool.argument_names"] = argumentNames(params.arguments);
      if (method === "initialize") {
        const client = clientInfoFrom(message.params);
        if (client.name) attributes["ireland_mcp.client.name"] = client.name;
        if (client.version) attributes["ireland_mcp.client.version"] = client.version;
      }
      const span = tracer().startSpan(tool ? `${method} ${tool}` : method, { kind: SpanKind.SERVER, attributes });
      return { span, id: message.id ?? undefined, started: performance.now(), metricAttributes };
    });
}

/** Runs `fn` with the single request's span active so upstream spans nest under it. */
export function withOperationContext<T>(operations: Operation[], fn: () => Promise<T>): Promise<T> {
  const only = operations.length === 1 ? operations[0] : undefined;
  return only ? context.with(trace.setSpan(context.active(), only.span), fn) : fn();
}

function toolErrorCode(result: unknown): string | undefined {
  const content = (result as { content?: Array<{ text?: unknown }> }).content;
  const text = content?.[0]?.text;
  if (typeof text !== "string") return undefined;
  try {
    const code = (JSON.parse(text) as { error?: { code?: unknown } }).error?.code;
    return typeof code === "string" && ERROR_CODE.test(code) ? code : undefined;
  } catch {
    return undefined;
  }
}

/** Matches responses to requests by id, sets error.type, ends spans and records the duration histogram. */
export function endMcpOperations(operations: Operation[], status: number, responseText: string | null): void {
  if (operations.length === 0) return;
  const byId = new Map<string, JsonRpcMessage>();
  for (const message of responseText ? messagesOf(responseText) : []) {
    if (message.id !== undefined && message.id !== null) byId.set(String(message.id), message);
  }
  for (const op of operations) {
    const reply = op.id === undefined ? undefined : byId.get(String(op.id));
    let errorType: string | undefined;
    if (reply?.error) errorType = String(reply.error.code ?? "_OTHER");
    else if (reply?.result && (reply.result as { isError?: unknown }).isError === true) {
      errorType = "tool_error";
      const code = toolErrorCode(reply.result);
      if (code) op.span.setAttribute("ireland_mcp.error.code", code);
    } else if (!reply && status >= 400) errorType = String(status);
    if (errorType) {
      op.span.setAttribute("error.type", errorType);
      op.span.setStatus({ code: SpanStatusCode.ERROR });
    }
    op.span.end();
    instruments().operationDuration.record((performance.now() - op.started) / 1000, {
      ...op.metricAttributes,
      ...(errorType ? { "error.type": errorType } : {})
    });
  }
}
