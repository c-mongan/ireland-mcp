# Architecture

The server is a stateless Azure Functions Flex app with a lean gateway in front of the source modules. The gateway owns the operation index, response budgets, cache, upstream budgets, circuit breakers, one jittered retry for transient 5xx/timeout failures and evidence envelope; every normal result includes source URL, licence, attribution and retrieval metadata.

| Diagram | Editable source |
| --- | --- |
| <img src="architecture/ireland-mcp-arch-v5.png" alt="Architecture v5" width="360"> | [`ireland-mcp-arch-v5.drawio`](architecture/ireland-mcp-arch-v5.drawio) |
| <img src="architecture/ireland-mcp-request-flow.png" alt="Ballymun request flow" width="360"> | [`ireland-mcp-request-flow.drawio`](architecture/ireland-mcp-request-flow.drawio) |
| <img src="architecture/ireland-mcp-lean-surface.png" alt="Lean surface comparison" width="360"> | [`ireland-mcp-lean-surface.drawio`](architecture/ireland-mcp-lean-surface.drawio) |

<p align="center">
  <a href="architecture/ireland-mcp-arch-v5.drawio">
    <img src="architecture/ireland-mcp-arch-v5.png" alt="Ireland MCP architecture: clients, Azure Functions gateway, observability and public data sources" width="900">
  </a>
</p>

How a call flows:

```mermaid
flowchart TD
  Q[Client question] --> T[ireland_call / nearby / search]
  T --> V[Schema validation]
  V --> C{Cache hit?}
  C -- yes --> E[Evidence envelope]
  C -- no --> B{Circuit breaker open?}
  B -- yes --> S{Stale cache available?}
  B -- no --> U[Upstream public API: CSO, Met Éireann, PPR, ...]
  U -- ok --> E
  U -- 5xx or timeout --> R[One jittered retry]
  R -- ok --> E
  R -- still failing --> S
  U -- other error --> S
  S -- yes --> F[Stale cached result: stale=true]
  F --> E
  S -- no --> X["MCP error: isError=true, UPSTREAM_DOWN with hint; no cited result"]
  E --> A[Answer with source URL, licence, attribution, retrieved_at]
```

## Operations

- `GET /healthz` is fast liveness; `GET /healthz?deep=1` performs one cheap check per source.
- A status workflow publishes [`status/status.json`](https://raw.githubusercontent.com/c-mongan/ireland-mcp/status/status/status.json) and 7-day history.
- OpenTelemetry can export MCP semantic-convention spans and operation-duration metrics to Azure Monitor.
- Tool logs and telemetry avoid argument values and IP addresses. See [PRIVACY.md](../PRIVACY.md).
- Optional PostHog usage metrics and Chromatic visual checks are described in [observability](observability.md) and the [quality loop](quality-loop.md).
- Browser CORS is restricted by `MCP_ALLOWED_ORIGINS`; non-browser MCP clients are unaffected.
