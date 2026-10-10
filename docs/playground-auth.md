# Playground and ChatGPT access

The [website playground](https://irishopendata.ie/#playground) sends read-only MCP requests directly to the public Ireland MCP endpoint. It needs no account or model subscription. It displays source data and its evidence fields. It does not generate an AI answer.

## Use Ireland MCP in ChatGPT

Add `https://mcp.irishopendata.ie/mcp` as a no-authentication developer connector in ChatGPT when developer mode is available for your account. See the [installation guide](../README.md#install) and the [OpenAI plugin quickstart](https://developers.openai.com/plugins/build/app-quickstart) for the current ChatGPT test route. The connector lets ChatGPT call the server with the user's own ChatGPT session. A website cannot assume that it can use that session.

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
