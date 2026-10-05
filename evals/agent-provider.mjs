// promptfoo provider: a small multi-round agent loop against the local MCP server, the way
// Claude, Copilot and ChatGPT use it (catalogue -> describe -> call). promptfoo's built-in MCP
// support stops after the first tool round, which scores meta-tool surfaces unfairly.
// Model: OPENAI_API_KEY (gpt-4.1-mini) or AZURE_API_KEY + AZURE_API_HOST + AZURE_DEPLOYMENT.
// Surface: EVAL_TOOLSETS=all (or a comma list) adds typed tools via --toolsets.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { setTimeout as sleep } from "node:timers/promises";

const MAX_RESULT_CHARS = 6000;

function chatEndpoint() {
  const { AZURE_API_KEY, AZURE_API_HOST, AZURE_DEPLOYMENT, OPENAI_API_KEY } = process.env;
  if (AZURE_API_KEY && AZURE_API_HOST && AZURE_DEPLOYMENT) {
    const host = AZURE_API_HOST.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    return {
      url: `https://${host}/openai/deployments/${encodeURIComponent(AZURE_DEPLOYMENT)}/chat/completions?api-version=2024-10-21`,
      headers: { "api-key": AZURE_API_KEY },
      model: undefined,
    };
  }
  if (OPENAI_API_KEY) {
    return { url: "https://api.openai.com/v1/chat/completions", headers: { authorization: `Bearer ${OPENAI_API_KEY}` }, model: "gpt-4.1-mini" };
  }
  throw new Error("No model key: set OPENAI_API_KEY, or AZURE_API_KEY with AZURE_API_HOST and AZURE_DEPLOYMENT.");
}

async function chat(endpoint, body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(endpoint.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...endpoint.headers },
      body: JSON.stringify(endpoint.model ? { model: endpoint.model, ...body } : body),
    });
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    throw new Error(`chat ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}

function resultText(result) {
  const text = (result.content ?? []).map((p) => (p.type === "text" ? p.text : `[${p.type}]`)).join("\n");
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}…` : text;
}

export default class AgentLoopProvider {
  constructor(options = {}) {
    this.config = options.config ?? {};
  }

  id() {
    return "ireland-mcp-agent-loop";
  }

  async callApi(prompt) {
    const endpoint = chatEndpoint();
    const toolsets = process.env.EVAL_TOOLSETS?.trim();
    const args = ["dist/src/cli.js", ...(toolsets ? [`--toolsets=${toolsets}`] : [])];
    const client = new Client({ name: "ireland-mcp-eval", version: "1.0.0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args, stderr: "ignore" }));
    const transcript = [];
    try {
      const { tools } = await client.listTools();
      const instructions = client.getInstructions?.() ?? "";
      const fnTools = tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description ?? "", parameters: t.inputSchema ?? { type: "object", properties: {} } },
      }));
      const messages = [
        ...(instructions ? [{ role: "system", content: instructions }] : []),
        { role: "user", content: prompt },
      ];
      const maxRounds = this.config.maxRounds ?? 4;
      for (let round = 0; round < maxRounds; round++) {
        // Reasoning models (gpt-5.x) reject temperature 0; EVAL_TEMPERATURE=default omits it.
        const temp = process.env.EVAL_TEMPERATURE === "default" ? {} : { temperature: 0 };
        const out = await chat(endpoint, { messages, tools: fnTools, ...temp });
        const msg = out.choices?.[0]?.message;
        if (!msg) break;
        messages.push(msg);
        if (!msg.tool_calls?.length) {
          transcript.push(msg.content ?? "");
          break;
        }
        for (const call of msg.tool_calls) {
          const name = call.function.name;
          let text;
          try {
            const callArgs = call.function.arguments ? JSON.parse(call.function.arguments) : {};
            const result = await client.callTool({ name, arguments: callArgs });
            text = resultText(result);
            const label = result.isError ? "Error" : "Result";
            // Arguments first so tool-calls.mjs can attribute ireland_call to its operation even on errors.
            transcript.push(`MCP Tool ${label} (${name}): ${JSON.stringify(callArgs)} ${text}`);
          } catch (err) {
            text = `Error: ${err instanceof Error ? err.message : String(err)}`;
            transcript.push(`MCP Tool Error (${name}): ${call.function.arguments ?? ""} ${text}`);
          }
          messages.push({ role: "tool", tool_call_id: call.id, content: text });
        }
      }
      return { output: transcript.join("\n") };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err), output: transcript.join("\n") };
    } finally {
      await client.close();
    }
  }
}
