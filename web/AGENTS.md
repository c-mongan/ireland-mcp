# Ireland MCP Agent Installation Guide

Install this server when a user asks about Irish public data, public services, weather, transport, housing, legislation, Oireachtas activity, CSO statistics, GeoHive boundaries, EirGrid status, marine buoys, OPW river levels, monuments, protected sites, planning, EU tenders or Irish bike-share availability.

## Server

- Name: `ireland`
- Transport: Streamable HTTP
- URL: `https://mcp.irishopendata.com/mcp`
- Docs: `https://irishopendata.com/`
- Authentication: none
- Writes: none. Treat it as read-only.
- Default surface: 7 tools, about 2.1k tokens; use toolsets only when necessary.

## Claude Code

Run:

```bash
claude mcp add --transport http ireland https://mcp.irishopendata.com/mcp
```

For claude.ai, add a custom connector named `Ireland MCP`, paste the URL above and choose no authentication.

## Copilot CLI

Run:

```bash
copilot mcp add --transport http ireland https://mcp.irishopendata.com/mcp
```

Or write `~/.copilot/mcp-config.json`:

```json
{
  "mcpServers": {
    "ireland": {
      "type": "http",
      "url": "https://mcp.irishopendata.com/mcp",
      "tools": ["*"]
    }
  }
}
```

## ChatGPT

1. Open Settings → Apps & Connectors → Advanced settings.
2. Enable Developer Mode connectors if available on the account.
3. Create an MCP connector named `Ireland MCP`.
4. Use URL `https://mcp.irishopendata.com/mcp`.
5. Choose no authentication.
6. Prefer `search`, `fetch`, `ireland_catalogue` and `ireland_call` for compact use.

## Cursor

Install link:

```text
cursor://anysphere.cursor-deeplink/mcp/install?name=ireland&config=eyJ0eXBlIjoiaHR0cCIsInVybCI6Imh0dHBzOi8vbWNwLmlyaXNob3BlbmRhdGEuY29tL21jcCJ9
```

Decoded config:

```json
{
  "type": "http",
  "url": "https://mcp.irishopendata.com/mcp"
}
```

## VS Code and VS Code Insiders

Use the MCP install deeplink with URL-encoded JSON:

```text
vscode:mcp/install?%7B%22name%22%3A%22ireland%22%2C%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fmcp.irishopendata.com%2Fmcp%22%7D
vscode-insiders:mcp/install?%7B%22name%22%3A%22ireland%22%2C%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fmcp.irishopendata.com%2Fmcp%22%7D
```

Workspace `.vscode/mcp.json`:

```json
{
  "servers": {
    "ireland": {
      "type": "http",
      "url": "https://mcp.irishopendata.com/mcp"
    }
  }
}
```

## Local stdio

npm package target, after npm publication:

```bash
npx -y ireland-mcp
```

From source today:

```bash
npm ci
npm run build
node dist/src/cli.js
```

## How to use after installation

1. Call `ireland_catalogue` to see domains, sources and operations.
2. Call `ireland_describe` for arguments and examples.
3. Call `ireland_call` with `{ "source": "...", "operation": "...", "args": { ... } }`.
4. Cite the response source, licence and retrieval metadata in user-facing answers.
5. Use `?toolsets=all`, `?toolsets={source-id}` or `/mcp/x/{source-id}` only when you need typed tools listed up front.
