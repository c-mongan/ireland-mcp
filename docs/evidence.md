# Evidence

What has been checked against the hosted endpoint, and how.

<p align="center">
  <img src="demo/inspector.gif" alt="MCP Inspector calling the hosted endpoint: nearby Galway, CSO profile for Ennis, Met Éireann forecast and Property Price Register stats, each with a source citation" width="800">
</p>

| Client (tested 7 Oct 2026 against the hosted endpoint) | Result |
| --- | --- |
| MCP Inspector (Playwright, [`scripts/demo-inspector.mjs`](../scripts/demo-inspector.mjs)) | 4/4 calls (`nearby`, CSO, Met Éireann, PPR) returned data with citations. [CSO Ennis](demo/inspector-cso-ennis.png), [PPR Galway 2024](demo/inspector-ppr-galway-2024.png). |
| VS Code Insiders, Copilot agent mode | Census 2022 Ennis (27,923 people) and Galway forecast, with CSO and Met Éireann citations. [Screenshot](demo/vscode-copilot-chat.png). |
| GitHub Copilot CLI | 3/3 questions answered with citations: Met Éireann Galway, PPR Cork, CSO Ennis. [Evidence](demo/README.md). |

## Screenshots

| Proof | Screenshot |
| --- | --- |
| Live landing page, desktop | <img src="screenshots/landing-desktop.png" alt="Ireland MCP live landing page on desktop" width="360"> |
| Live landing page, mobile | <img src="screenshots/landing-mobile.png" alt="Ireland MCP live landing page on mobile" width="180"> |
| Install section with one-click client setup | <img src="screenshots/install-section.png" alt="One-click install section for VS Code, Cursor, Claude, ChatGPT and Copilot CLI" width="360"> |
| Playground populated from a real live MCP call | <img src="screenshots/playground-live-call.png" alt="Playground showing a real cso_search_tables result from the live MCP endpoint" width="360"> |
| MCP Inspector connected to the live endpoint | <img src="screenshots/mcp-inspector-live.png" alt="MCP Inspector showing tools/list and an ireland_call result" width="360"> |
| Real model transcript: question → tool calls → answer | <img src="screenshots/agent-transcript.png" alt="Azure OpenAI agent transcript using Ireland MCP tools" width="360"> |

## Video

<!-- portfolio-video:start -->

## Short video overview

**21 seconds.** Recorded MCP Inspector example. Figures and forecasts are historical.

[![Watch the 21-second video overview](portfolio-video/poster.jpg)](https://github.com/c-mongan/ireland-mcp/releases/tag/portfolio-overview-2026-10-23)

[Watch on GitHub](https://github.com/c-mongan/ireland-mcp/releases/tag/portfolio-overview-2026-10-23) · [Download MP4](https://github.com/c-mongan/ireland-mcp/releases/download/portfolio-overview-2026-10-23/ireland.mp4) · [Transcript](portfolio-video/transcript.txt) · [Captions](portfolio-video/captions.srt) · [Credits and source notes](portfolio-video/README.md)
<!-- portfolio-video:end -->
