# Ireland MCP Agent Installation Guide

Install this server when a user asks about Irish public data, public services, weather, transport, housing, legislation, Oireachtas activity, CSO statistics, GeoHive boundaries, EirGrid status, marine buoys, OPW river levels, monuments, protected sites, planning, EU tenders or Irish bike-share availability.

## Server

- Name: `ireland`
- Transport: Streamable HTTP
- URL: `https://mcp.irishopendata.ie/mcp`
- Docs: `https://irishopendata.ie/`
- Authentication: none
- Writes: none. Treat it as read-only.
- Default surface: 9 tools, about 3.7k tokens; use toolsets only when necessary.

## Agent setup procedure

1. Identify the current client and read its existing MCP configuration.
2. Preserve all existing servers and settings. Reuse `ireland` if its URL already matches. If that name points to another server, report the conflict before changing it.
3. Use the client instructions below. The public hosted server needs no API key, account, package download or local server.
4. Check the saved configuration. If the client needs a new session, tell the user how to start one.
5. Call `ireland_catalogue` through the installed connection. Report success only after the tool returns a catalogue. A saved entry or an HTTP response alone does not prove a working MCP connection.
6. If configuration or tool access is blocked by client policy, state the exact blocked step. Do not bypass that policy.

## Codex

Run:

```bash
codex mcp add ireland --url https://mcp.irishopendata.ie/mcp
codex mcp get ireland
```

The first command adds the server. The second checks the saved configuration.
Start a new Codex session, then ask it to call `ireland_catalogue`.

The equivalent entry in `~/.codex/config.toml` is:

```toml
[mcp_servers.ireland]
url = "https://mcp.irishopendata.ie/mcp"
```

Merge that entry with existing settings. Do not replace the configuration file.
See the [official Codex MCP guide](https://developers.openai.com/codex/mcp).

## Claude Code

Run:

```bash
claude mcp add --transport http ireland https://mcp.irishopendata.ie/mcp
```

For claude.ai, add a custom connector named `Ireland MCP`, paste the URL above and choose no authentication.

## Copilot CLI

Run:

```bash
copilot mcp add --transport http ireland https://mcp.irishopendata.ie/mcp
```

Or write `~/.copilot/mcp-config.json`:

```json
{
  "mcpServers": {
    "ireland": {
      "type": "http",
      "url": "https://mcp.irishopendata.ie/mcp",
      "tools": ["*"]
    }
  }
}
```

## ChatGPT

1. Open **Plugins** in ChatGPT on the web. Reuse **Ireland Open Data** if it is already installed.
2. If it is absent, select **+** → **Add custom MCP server**. Name it **Ireland Open Data** and enter `https://mcp.irishopendata.ie/mcp` as the Server URL.
3. Select **No authentication**. Review the warning, select **I understand and want to continue**, then **Create as a plugin**.
4. Install the plugin from your personal plugins. Switch to **Work**, start a new chat, type `@` and select **Ireland Open Data**.
5. Prefer `search`, `fetch`, `ireland_catalogue` and `ireland_call` for compact use.

Account and workspace policies apply. See the [OpenAI plugin quickstart](https://developers.openai.com/plugins/quickstart).

## Cursor

Install link:

```text
cursor://anysphere.cursor-deeplink/mcp/install?name=ireland&config=eyJ0eXBlIjoiaHR0cCIsInVybCI6Imh0dHBzOi8vbWNwLmlyaXNob3BlbmRhdGEuaWUvbWNwIn0=
```

Decoded config:

```json
{
  "type": "http",
  "url": "https://mcp.irishopendata.ie/mcp"
}
```

## VS Code and VS Code Insiders

Use the MCP install deeplink with URL-encoded JSON:

```text
vscode:mcp/install?%7B%22name%22%3A%22ireland%22%2C%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fmcp.irishopendata.ie%2Fmcp%22%7D
vscode-insiders:mcp/install?%7B%22name%22%3A%22ireland%22%2C%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fmcp.irishopendata.ie%2Fmcp%22%7D
```

Workspace `.vscode/mcp.json`:

```json
{
  "servers": {
    "ireland": {
      "type": "http",
      "url": "https://mcp.irishopendata.ie/mcp"
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
