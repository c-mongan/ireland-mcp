#!/usr/bin/env node
// Runs the promptfoo eval locally. Skips cleanly when no model key is present, so CI never spends tokens.
// OpenAI:        OPENAI_API_KEY=... npm run eval
// Azure OpenAI:  AZURE_API_KEY=... AZURE_API_HOST=<resource>.openai.azure.com AZURE_DEPLOYMENT=<deployment> npm run eval
// Surface:       EVAL_TOOLSETS=all npm run eval   (default: the lean meta-tool surface)
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const base = "evals/promptfooconfig.yaml";
const openaiProvider = "openai:chat:gpt-4.1-mini";
let config = base;
let cleanup = () => {};

const serverArgs = `args: ["dist/src/cli.js"]`;
const toolsets = process.env.EVAL_TOOLSETS?.trim();
let yaml = readFileSync(base, "utf8");
let rewritten = false;

if (process.env.AZURE_API_KEY && process.env.AZURE_API_HOST && process.env.AZURE_DEPLOYMENT) {
  const host = process.env.AZURE_API_HOST.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const provider = `azure:chat:${process.env.AZURE_DEPLOYMENT}`;
  if (!yaml.includes(`- id: ${openaiProvider}\n    config:\n`)) {
    console.error(`eval: ${base} no longer matches the expected provider layout; update scripts/eval.mjs.`);
    process.exit(1);
  }
  yaml = yaml
    .replace(`- id: ${openaiProvider}\n    config:\n`, `- id: ${provider}\n    config:\n      apiHost: ${host}\n`)
    .replace(`provider: ${openaiProvider}`, `provider: ${provider}`);
  rewritten = true;
  console.log(`eval: using Azure OpenAI deployment ${process.env.AZURE_DEPLOYMENT} on ${host}`);
} else if (!process.env.OPENAI_API_KEY) {
  console.log("Skipping eval: set OPENAI_API_KEY, or AZURE_API_KEY with AZURE_API_HOST and AZURE_DEPLOYMENT.");
  process.exit(0);
}

if (toolsets) {
  if (!/^[a-z0-9,-]+$/.test(toolsets) || !yaml.includes(serverArgs)) {
    console.error(`eval: EVAL_TOOLSETS must be a comma list of source ids (or "all"), and ${base} must contain ${serverArgs}.`);
    process.exit(1);
  }
  yaml = yaml.replace(serverArgs, `args: ["dist/src/cli.js", "--toolsets=${toolsets}"]`);
  rewritten = true;
}
console.log(`eval: tool surface ${toolsets ? `toolsets=${toolsets}` : "default (meta tools)"}`);

if (rewritten) {
  // file:// paths resolve against the config's directory, so pin the transform before moving the config.
  yaml = yaml.replace("file://tool-calls.mjs", `file://${resolve("evals/tool-calls.mjs")}`);
  const dir = mkdtempSync(join(tmpdir(), "ireland-mcp-eval-"));
  config = join(dir, "promptfooconfig.yaml");
  // promptfoo resolves the MCP server path against the working directory, so a temp config is safe.
  writeFileSync(config, yaml);
  cleanup = () => rmSync(dir, { recursive: true, force: true });
}

const r = spawnSync("npx", ["-y", "promptfoo@0.123.1", "eval", "-c", config, ...process.argv.slice(2)], { stdio: "inherit" });
cleanup();
process.exit(r.status ?? 1);
