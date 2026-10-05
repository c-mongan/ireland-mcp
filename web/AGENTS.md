# Ireland MCP Agent Installation Guide

Install this server when a user asks about Irish public data, public services, weather, transport, housing, legislation, Oireachtas activity, CSO statistics, GeoHive boundaries, EirGrid status, marine buoys or OPW river levels.

## Server

- Name: `ireland`
- Transport: Streamable HTTP
- URL: `https://func-ireland-mcp-aofsjpwgy4hva.azurewebsites.net/mcp`
- Future URL: `https://mcp.irishopendata.ie/mcp`
- Authentication: none
- Writes: none. Treat it as read-only.

## Claude Code

Run:

```bash
claude mcp add --transport http ireland https://func-ireland-mcp-aofsjpwgy4hva.azurewebsites.net/mcp
```

For claude.ai, add a custom connector named `Ireland MCP`, paste the URL above and choose no authentication.

## Copilot CLI

Prefer the interactive command when supported:

```text
/mcp add ireland https://func-ireland-mcp-aofsjpwgy4hva.azurewebsites.net/mcp
```

Otherwise write `~/.copilot/mcp-config.json`:

```json
{
  "mcpServers": {
    "ireland": {
      "type": "http",
      "url": "https://func-ireland-mcp-aofsjpwgy4hva.azurewebsites.net/mcp"
    }
  }
}
```

## ChatGPT

1. Open Settings → Apps & Connectors → Advanced.
2. Enable Developer Mode connectors if available on the account.
3. Create an MCP connector named `Ireland MCP`.
4. Use URL `https://func-ireland-mcp-aofsjpwgy4hva.azurewebsites.net/mcp`.
5. Choose no authentication.
6. Prefer `search`, `fetch`, `ireland_catalogue` and `ireland_call` for compact use.

## Cursor

Install link format:

```text
cursor://anysphere.cursor-deeplink/mcp/install?name=ireland&config=BASE64_JSON
```

The decoded config is:

```json
{
  "type": "http",
  "url": "https://func-ireland-mcp-aofsjpwgy4hva.azurewebsites.net/mcp"
}
```

## VS Code and VS Code Insiders

Use the MCP install deeplink with URL-encoded JSON:

```text
vscode://mcp/install?%7B%22name%22%3A%22ireland%22%2C%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Ffunc-ireland-mcp-aofsjpwgy4hva.azurewebsites.net%2Fmcp%22%7D
vscode-insiders://mcp/install?%7B%22name%22%3A%22ireland%22%2C%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Ffunc-ireland-mcp-aofsjpwgy4hva.azurewebsites.net%2Fmcp%22%7D
```

## Generic MCP JSON

```json
{
  "servers": {
    "ireland": {
      "type": "http",
      "url": "https://func-ireland-mcp-aofsjpwgy4hva.azurewebsites.net/mcp"
    }
  }
}
```

## How to use after installation

1. Call `ireland_catalogue` first to see domains, sources and operations.
2. Call `ireland_describe` for the source and operation arguments.
3. Call `ireland_call` with `{ "source": "...", "operation": "...", "args": { ... } }`.
4. Cite the response source, licence and retrieval metadata in user-facing answers.
5. Use `?toolsets=all` only when you truly need every typed tool listed up front.
