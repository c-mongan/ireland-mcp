#!/usr/bin/env node
// Runs the promptfoo eval locally. Skips cleanly when no model key is present, so CI never spends tokens.
// OpenAI:        OPENAI_API_KEY=... npm run eval
// Azure OpenAI:  AZURE_API_KEY=... AZURE_API_HOST=<resource>.openai.azure.com AZURE_DEPLOYMENT=<deployment> npm run eval
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = "evals/promptfooconfig.yaml";
const openaiProvider = "openai:chat:gpt-4.1-mini";
let config = base;
let cleanup = () => {};

if (process.env.AZURE_API_KEY && process.env.AZURE_API_HOST && process.env.AZURE_DEPLOYMENT) {
  const host = process.env.AZURE_API_HOST.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const provider = `azure:chat:${process.env.AZURE_DEPLOYMENT}`;
  const yaml = readFileSync(base, "utf8");
  if (!yaml.includes(`- id: ${openaiProvider}\n    config:\n`)) {
    console.error(`eval: ${base} no longer matches the expected provider layout; update scripts/eval.mjs.`);
    process.exit(1);
  }
  const out = yaml
    .replace(`- id: ${openaiProvider}\n    config:\n`, `- id: ${provider}\n    config:\n      apiHost: ${host}\n`)
    .replace(`provider: ${openaiProvider}`, `provider: ${provider}`);
  const dir = mkdtempSync(join(tmpdir(), "ireland-mcp-eval-"));
  config = join(dir, "promptfooconfig.yaml");
  // promptfoo resolves the MCP server path against the working directory, so a temp config is safe.
  writeFileSync(config, out);
  cleanup = () => rmSync(dir, { recursive: true, force: true });
  console.log(`eval: using Azure OpenAI deployment ${process.env.AZURE_DEPLOYMENT} on ${host}`);
} else if (!process.env.OPENAI_API_KEY) {
  console.log("Skipping eval: set OPENAI_API_KEY, or AZURE_API_KEY with AZURE_API_HOST and AZURE_DEPLOYMENT.");
  process.exit(0);
}

const r = spawnSync("npx", ["-y", "promptfoo@0.123.1", "eval", "-c", config, ...process.argv.slice(2)], { stdio: "inherit" });
cleanup();
process.exit(r.status ?? 1);
