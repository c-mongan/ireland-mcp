#!/usr/bin/env node
// Runs the promptfoo eval locally. Skips cleanly when no model key is present, so CI never spends tokens.
// OpenAI:        OPENAI_API_KEY=... npm run eval
// Azure OpenAI:  AZURE_API_KEY=... AZURE_API_HOST=<resource>.openai.azure.com AZURE_DEPLOYMENT=<deployment> npm run eval
// Surface:       EVAL_TOOLSETS=all npm run eval   (default: the lean meta-tool surface)
// evals/agent-provider.mjs reads these variables and runs a multi-round tool loop against dist/src/cli.js.
import { spawnSync } from "node:child_process";

const azure = process.env.AZURE_API_KEY && process.env.AZURE_API_HOST && process.env.AZURE_DEPLOYMENT;
if (!azure && !process.env.OPENAI_API_KEY) {
  console.log("Skipping eval: set OPENAI_API_KEY, or AZURE_API_KEY with AZURE_API_HOST and AZURE_DEPLOYMENT.");
  process.exit(0);
}
const toolsets = process.env.EVAL_TOOLSETS?.trim();
if (toolsets && !/^[a-z0-9,-]+$/.test(toolsets)) {
  console.error(`eval: EVAL_TOOLSETS must be a comma list of source ids (or "all").`);
  process.exit(1);
}
console.log(`eval: model ${azure ? `Azure OpenAI deployment ${process.env.AZURE_DEPLOYMENT}` : "OpenAI gpt-4.1-mini"}`);
console.log(`eval: tool surface ${toolsets ? `toolsets=${toolsets}` : "default (meta tools)"}`);

const r = spawnSync("npx", ["-y", "promptfoo@0.123.1", "eval", "-c", "evals/promptfooconfig.yaml", ...process.argv.slice(2)], {
  stdio: "inherit",
});
process.exit(r.status ?? 1);
