# Playground and ChatGPT access

The [website playground](https://irishopendata.ie/#playground) sends read-only MCP requests directly to the public Ireland MCP endpoint. It needs no account or model subscription. It displays source data and its evidence fields. It does not generate an AI answer.

## Use Ireland MCP in ChatGPT

Use the [OpenAI plugin quickstart](https://developers.openai.com/plugins/quickstart), checked on 10 October 2026:

1. Open **Plugins** in ChatGPT on the web. If **Ireland Open Data** is already installed, use that plugin.
2. If it is absent, select **+** → **Add custom MCP server**. Name it **Ireland Open Data**, enter `https://mcp.irishopendata.ie/mcp` as the Server URL and select **No authentication**. Review the warning, select **I understand and want to continue**, then **Create as a plugin**.
3. Install the resulting plugin from your personal plugins. Switch the ChatGPT homepage to **Work**, start a new chat, type `@` and select **Ireland Open Data**. See the [OpenAI plugin quickstart](https://developers.openai.com/plugins/quickstart).

Workspace permissions and security restrictions can limit custom MCP access. Ireland MCP uses public Streamable HTTP and requires no client key or OAuth setup. ChatGPT calls it through the user's ChatGPT session; the website playground cannot assume access to that session.

**Verified on 10 October 2026:** the plugin was already installed. ChatGPT reported 39 seconds of work for a new Work query. Its answer gave a retrieval time of `18:54:03.960 UTC` and reported **€1,672.57** for a **two-bed apartment in Galway City, Q4 2025**, with a cached result, [CSO table RIQ02](https://data.cso.ie/table/RIQ02) and CC BY 4.0 attribution. This is a historical quarterly RTB registered-tenancy average, not a current asking rent.

The inspected Work trace showed three **“Used Ireland Open Data integration”** entries. No raw JSON inspection control was found in that UI. This proves plugin use and the displayed answer; it does not expose the exact ChatGPT tool arguments or raw response.

## Sign in with ChatGPT

Official OpenAI documentation checked on 10 October 2026 describes two distinct routes:

| Route | Current requirement | Ireland MCP decision |
| --- | --- | --- |
| Shared hosted website | Selected partner trial; an issued OAuth client and exact registered callbacks are required. Identity sign-in does not itself grant inference access. | No active login button until this application has the required registration. |
| Local open-source app | Dynamic registration, a stable host identity, a loopback callback, separate plan-use consent and protected local credentials. | Supported candidate for a local AI playground. This route has not been implemented or verified here. |

The local route does not need a partner client secret. It does need a real OAuth implementation. Each sign-in must validate state, PKCE, nonce and the signed ID token. Requests can use the user's plan only after the required scopes are granted. Credentials must stay under that user's control. Do not reuse a developer's Codex credentials or copy session cookies into the website.

```text
Public website → Public MCP → Cited source data

Local AI playground → User's ChatGPT sign-in → User's model request
         ↓                                      ↓
     Public MCP ← Selected read-only tool ← Answer with evidence
```

A local implementation would need account selection, consent, sign-out, protected token refresh, a bounded tool loop, cancellations, source citations and tests for rejected or expired credentials. Usage limits and model availability must come from the user's granted connection. PostHog must not receive prompts, answers, tokens, account identifiers or source arguments.

Sources: [OpenAI website sign-in](https://developers.openai.com/siwc/website), [ChatGPT plan use for open-source apps](https://developers.openai.com/siwc/token-sharing-open-source), and [registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in). Availability can change; verify these sources before implementation.

## Frontend framework

Vite is a build tool. React is a UI library. They can be used together. The production website currently uses plain HTML, CSS and JavaScript; Storybook uses a React/Vite adapter for the same production sections.

A React migration is not required for Chromatic, PostHog, MCP access or the current query playground. Consider a real reusable React playground component when account state and streamed AI turns justify it. A full migration must preserve the installer, keyboard behavior, query retry, status feed, theme and motion settings, privacy controls and all current browser checks. Changing a framework alone does not improve data accuracy.
