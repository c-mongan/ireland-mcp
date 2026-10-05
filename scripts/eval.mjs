#!/usr/bin/env node
// Runs the promptfoo eval locally. Skips cleanly when no model key is present, so CI never spends tokens.
import { spawnSync } from "node:child_process";

if (!process.env.OPENAI_API_KEY) {
  console.log("Skipping eval: OPENAI_API_KEY is not set.");
  process.exit(0);
}
const r = spawnSync("npx", ["-y", "promptfoo@0.123.1", "eval", "-c", "evals/promptfooconfig.yaml", ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(r.status ?? 1);
