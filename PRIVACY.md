# Privacy

Ireland MCP is a read-only gateway to public Irish open data. It has no accounts and stores
no personal data. This page lists exactly what the hosted endpoint records.

## What is recorded

| Data | Where | Kept |
| --- | --- | --- |
| MCP method and tool name (`tools/call cso_get_data`) | OpenTelemetry spans and the `mcp.server.operation.duration` metric | App Insights retention (90 days default) |
| Argument **names** only (`table_code`, `dimensions`), never values | Span attribute `ireland_mcp.tool.argument_names` | Same |
| Client name and version from `initialize` (`claude-ai 1.0`) | Span attributes `ireland_mcp.client.name/version` | Same |
| Outcome: duration, JSON-RPC/HTTP error type, typed error code (`UPSTREAM_DOWN`) | Spans, metric, one stderr JSON line per tool call | Same |
| Upstream calls: source id, host name, HTTP method, status, cache hit/stale | Client spans (`ireland_mcp.source.id`), `http.client.request.duration` | Same |
| MCP session id, if a client sends one | Span attribute `mcp.session.id` (the server is stateless and issues none) | Same |

## What is never recorded

- **Argument values.** Search terms, place names, coordinates, Eircodes and table codes
  you send stay out of telemetry and logs.
- **IP addresses.** No span, metric or log line contains one. Auto-instrumentation is off,
  so the OpenTelemetry SDK adds nothing of its own. The Functions host keeps App Insights'
  default IP masking (client IP is stored as `0.0.0.0`).
- **Full upstream URLs.** Upstream spans hold the host name only, because query strings can
  echo user input.
- **Response bodies.**

## Rate limiting

The per-client rate limit (60 requests a minute by default) needs a key per caller. The key
is an HMAC-SHA256 of the caller's IP address with a random 32-byte salt, truncated to 22
characters. The salt lives only in memory, and a new one is generated each UTC day and
on every restart, so keys cannot be linked across days or reversed to an IP. The key and
its counter are held in memory for the current one-minute window only and are never logged
or exported.

## Origin checks

Browser requests to `/mcp` must come from an allowed origin (see `MCP_ALLOWED_ORIGINS` in the
README). The `Origin` header is compared and then discarded; it is not recorded.

## Status feed

A scheduled GitHub Action calls `/healthz?deep=1` and publishes per-source up/down status
and latency to the public `status` branch. It contains no client data.

## Turning telemetry off

Telemetry export only runs when `APPLICATIONINSIGHTS_CONNECTION_STRING` is set. Set
`IRELAND_MCP_OTEL=off` to disable it on a deployment that has one, and
`IRELAND_MCP_TELEMETRY=off` to silence the stderr tool-call lines. Local stdio use sends
nothing anywhere.

Questions or concerns: open an issue, or see [SECURITY.md](SECURITY.md) for private reports.
