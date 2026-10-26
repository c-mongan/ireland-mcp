#!/usr/bin/env node
// Multi-step benchmark runner. See docs/evals-multistep.md.
//
//   npm run eval:multistep                       references only: recompute every reference via the real tools
//   npm run eval:multistep -- --agent            also run a model agent (OPENAI_API_KEY or AZURE_*; skips cleanly without)
//   npm run eval:multistep -- --oracle           score the references as if they were an agent's answers (scorer self-check)
//   npm run eval:multistep -- --pin              write fresh references to evals/multistep/references.json
//   --url https://mcp.irishopendata.ie/mcp      run against the hosted endpoint instead of local stdio dist/src/cli.js
//   --only id1,id2  --tier T2  --out dir  --delay-ms 250  --strict (exit 1 on reference errors)
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { GapError, UpstreamError, connect, loadCatalogue, makeContext, pillarOf, pillarProbes, GAP_PILLARS } from "./lib.mjs";
import { checkKey, failureSymptoms, scoreAnswer } from "./score.mjs";
import { items, AS_OF_DATE } from "./questions.mjs";

const HERE = new URL("./", import.meta.url);
const PINNED = new URL("references.json", HERE);
const ITEM_TIMEOUT_MS = 120_000;

function parseArgs(argv) {
  const o = { mode: "references", url: null, only: null, tier: null, pin: false, out: "evals/multistep/out", delayMs: 0, strict: false, repeats: 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => (a.includes("=") ? a.slice(a.indexOf("=") + 1) : argv[++i]);
    if (a === "--agent") o.mode = "agent";
    else if (a === "--oracle") o.mode = "oracle";
    else if (a === "--pin") o.pin = true;
    else if (a === "--strict") o.strict = true;
    else if (a.startsWith("--url")) o.url = val();
    else if (a.startsWith("--only")) o.only = new Set(val().split(","));
    else if (a.startsWith("--tier")) o.tier = val().toUpperCase();
    else if (a.startsWith("--out")) o.out = val();
    else if (a.startsWith("--delay-ms")) o.delayMs = Number(val());
    else if (a.startsWith("--repeats")) o.repeats = Math.max(1, Number(val()));
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

const withTimeout = (p, ms, label) =>
  Promise.race([p, sleep(ms, undefined, { ref: false }).then(() => Promise.reject(new UpstreamError(`${label} timed out after ${ms} ms`, "TIMEOUT")))]);

function gitSha() {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

function loadPinned() {
  return existsSync(PINNED) ? JSON.parse(readFileSync(PINNED, "utf8")) : { items: {} };
}

/** True when two reference results agree within each key's tolerance. */
function sameReference(item, a, b) {
  return Object.keys(item.answer).every((k) => checkKey(item.answer[k], a[k], b[k]));
}

async function runReference(client, catalogue, probes, item, pinned, opts) {
  const ctx = makeContext(client, { delayMs: opts.delayMs, catalogue });
  const started = Date.now();
  const base = { id: item.id, tier: item.tier, drift: item.drift };
  try {
    const expected = await withTimeout(item.reference(ctx), ITEM_TIMEOUT_MS, item.id);
    const missing = Object.keys(item.answer).filter((k) => expected[k] === undefined || expected[k] === null || Number.isNaN(expected[k]));
    // A live feed that has no value right now (e.g. EirGrid between intervals) is an upstream gap, not a broken reference.
    if (missing.length && item.drift === "live") throw new UpstreamError(`live value missing upstream: ${missing.join(", ")}`, "MISSING_LIVE_VALUE");
    if (missing.length) throw new Error(`reference left keys empty: ${missing.join(", ")}`);
    const pin = pinned.items[item.id];
    let status = "ok";
    if (pin?.expected && item.drift !== "live" && !sameReference(item, pin.expected, expected)) status = "changed";
    return { ...base, status, expected, pinned: pin?.expected ?? null, calls: ctx.calls, workarounds: [...ctx.workarounds], ms: Date.now() - started };
  } catch (err) {
    const common = { ...base, calls: ctx.calls, workarounds: [...ctx.workarounds], ms: Date.now() - started };
    if (err instanceof GapError) {
      const present = probes[pillarOf(err.tag)] === true;
      return { ...common, status: present ? "gap-capability-present" : "gap", gap: err.tag, evidence: err.evidence };
    }
    if (err instanceof UpstreamError) return { ...common, status: "upstream_error", error: err.message };
    return { ...common, status: "reference_error", error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------- agent ----------------

function chatEndpoint() {
  const { AZURE_API_KEY, AZURE_API_HOST, AZURE_DEPLOYMENT, OPENAI_API_KEY, EVAL_MODEL } = process.env;
  if (AZURE_API_KEY && AZURE_API_HOST && AZURE_DEPLOYMENT) {
    const host = AZURE_API_HOST.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    return { label: `Azure OpenAI ${AZURE_DEPLOYMENT}`, url: `https://${host}/openai/deployments/${encodeURIComponent(AZURE_DEPLOYMENT)}/chat/completions?api-version=2024-10-21`, headers: { "api-key": AZURE_API_KEY } };
  }
  if (OPENAI_API_KEY) {
    const model = EVAL_MODEL || "gpt-4.1-mini";
    return { label: `OpenAI ${model}`, url: "https://api.openai.com/v1/chat/completions", headers: { authorization: `Bearer ${OPENAI_API_KEY}` }, model };
  }
  return null;
}

async function chat(endpoint, body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(endpoint.url, { method: "POST", headers: { "content-type": "application/json", ...endpoint.headers }, body: JSON.stringify(endpoint.model ? { model: endpoint.model, ...body } : body) });
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    throw new Error(`chat ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}

const ROUNDS = { T1: 8, T2: 12, T3: 16 };

function agentPrompt(item) {
  const keys = Object.entries(item.answer).map(([k, s]) => `  "${k}": ${s.type}${s.desc ? ` (${s.desc})` : ""}`).join("\n");
  return [
    "Answer this question about Ireland using only the tools provided. Combine sources where needed, do the arithmetic carefully, and cite each source you used (name and URL).",
    "If part of the answer cannot be obtained with the tools, say which capability is missing and use null for that key.",
    "",
    `Question: ${item.question}`,
    "",
    "End your reply with a fenced block exactly like:",
    "```ANSWER_JSON",
    "{",
    keys,
    "}",
    "```",
    "Numbers must be plain numbers (no units or thousands separators). Lists are JSON arrays of names."
  ].join("\n");
}

async function runAgent(client, endpoint, tools, instructions, item) {
  const fnTools = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description ?? "", parameters: t.inputSchema ?? { type: "object", properties: {} } } }));
  const messages = [...(instructions ? [{ role: "system", content: instructions }] : []), { role: "user", content: agentPrompt(item) }];
  const calls = [];
  const maxRounds = Number(process.env.EVAL_MAX_ROUNDS) || ROUNDS[item.tier] || 8;
  const maxChars = Number(process.env.EVAL_MAX_RESULT_CHARS) || 12000;
  const temp = process.env.EVAL_TEMPERATURE === "default" ? {} : { temperature: 0 };
  let answer = "";
  let hitRoundCap = true;
  for (let round = 0; round < maxRounds; round++) {
    const out = await chat(endpoint, { messages, tools: fnTools, ...temp });
    const msg = out.choices?.[0]?.message;
    if (!msg) break;
    messages.push(msg);
    if (!msg.tool_calls?.length) {
      answer = msg.content ?? "";
      hitRoundCap = false;
      break;
    }
    for (const tc of msg.tool_calls) {
      let args = {};
      let text;
      let isError;
      let truncated = false;
      try {
        args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        const r = await client.callTool({ name: tc.function.name, arguments: args });
        text = (r.content ?? []).map((p) => (p.type === "text" ? p.text : `[${p.type}]`)).join("\n");
        isError = Boolean(r.isError);
        truncated = Boolean(r.structuredContent?.truncated) || /"truncated":\s*true/.test(text);
      } catch (err) {
        text = `Error: ${err instanceof Error ? err.message : String(err)}`;
        isError = true;
      }
      const source = tc.function.name === "ireland_call" ? args.source : null;
      const operation = tc.function.name === "ireland_call" ? args.operation : tc.function.name;
      calls.push({ name: tc.function.name, source, operation, isError, truncated, text: text.slice(0, 400) });
      messages.push({ role: "tool", tool_call_id: tc.id, content: text.length > maxChars ? `${text.slice(0, maxChars)}…` : text });
    }
  }
  return { answer, calls, hitRoundCap };
}

function scoreRun(item, expected, run, sourceOfOp) {
  const scored = scoreAnswer(item, expected, run.answer);
  const used = new Set(
    run.calls.filter((c) => !c.isError).map((c) => c.source ?? sourceOfOp.get(c.operation) ?? (c.operation === "nearby" ? "cross" : null)).filter(Boolean)
  );
  const missingSources = item.required_sources.filter((s) => !used.has(s));
  const symptoms = scored.strict_pass ? [] : failureSymptoms({ calls: run.calls, answer: run.answer, hitRoundCap: run.hitRoundCap });
  // A declared gap is attributed only when a transcript symptom points at the same pillar.
  const symptomPillars = new Set(symptoms.map(pillarOf));
  const attributed = scored.strict_pass ? [] : item.gaps.filter((g) => symptomPillars.has(pillarOf(g)) || (symptoms.includes("declared-unavailable") && pillarOf(g) !== "source"));
  return {
    ...scored,
    tool_calls: run.calls.length,
    tool_errors: run.calls.filter((c) => c.isError).length,
    sources_used: [...used],
    sources_cited_in_trace: missingSources.length === 0,
    missing_sources: missingSources,
    symptoms,
    attributed_gaps: attributed.length ? attributed : scored.strict_pass ? [] : ["unattributed"]
  };
}

// ---------------- report ----------------

function md(report) {
  const L = [];
  const refs = report.references;
  const by = (s) => refs.filter((r) => r.status === s);
  L.push(`# Multi-step benchmark report`, "");
  L.push(`- Run: ${report.run_at} · server ${report.server} · git ${report.git_sha ?? "unknown"} · question set as of ${report.as_of}`);
  L.push(`- Mode: ${report.mode}${report.model ? ` · model ${report.model}` : ""}`);
  L.push(`- Items: ${refs.length} (${["T1", "T2", "T3"].map((t) => `${t} ${refs.filter((r) => r.tier === t).length}`).join(", ")})`, "");
  L.push(`## References`, "");
  L.push(`| Status | Items | Meaning |`, `| --- | ---: | --- |`);
  const meaning = {
    ok: "Reference recomputed through the real tools",
    changed: "Recomputed value differs from the pinned reference (stale pin or upstream revision; review, then --pin)",
    gap: "Unanswerable with today's catalogue (capability gap)",
    "gap-capability-present": "Blocking capability now exists: write the reference",
    upstream_error: "Upstream refused or timed out; not a benchmark signal",
    reference_error: "Reference code or tool contract broke; investigate"
  };
  for (const s of Object.keys(meaning)) if (by(s).length) L.push(`| ${s} | ${by(s).length} | ${meaning[s]} |`);
  L.push("");
  if (report.agent) {
    const a = report.agent.items.filter((x) => !x.skipped && !x.unanswerable);
    const pass = (t) => a.filter((x) => (!t || x.tier === t) && x.strict_pass).length;
    const n = (t) => a.filter((x) => !t || x.tier === t).length;
    L.push(`## Agent scores`, "");
    L.push(`| Tier | Strict pass | Lenient pass | Mean key accuracy | Sources in trace | Median tool calls |`, `| --- | ---: | ---: | ---: | ---: | ---: |`);
    for (const t of [null, "T1", "T2", "T3"]) {
      const rows = a.filter((x) => !t || x.tier === t);
      if (!rows.length) continue;
      const calls = rows.map((x) => x.tool_calls).sort((p, q) => p - q);
      L.push(`| ${t ?? "All"} | ${pass(t)}/${n(t)} | ${rows.filter((x) => x.lenient_pass).length}/${n(t)} | ${(rows.reduce((s, x) => s + x.key_fraction, 0) / rows.length).toFixed(2)} | ${rows.filter((x) => x.sources_cited_in_trace).length}/${n(t)} | ${calls[Math.floor(calls.length / 2)]} |`);
    }
    const controls = a.filter((x) => x.control);
    if (controls.length) L.push("", `Control items (no pillar needed): ${controls.filter((x) => x.strict_pass).length}/${controls.length} strict pass.`);
    const blocked = report.agent.items.filter((x) => x.unanswerable);
    if (blocked.length) L.push("", `Blocked items (no reference possible): the agent said the data was unavailable in ${blocked.filter((x) => x.admitted_gap).length}/${blocked.length}; any other answer is unsupported.`);
    const skipped = report.agent.items.filter((x) => x.skipped);
    if (skipped.length) L.push("", `Skipped (reference unavailable this run): ${skipped.map((x) => x.id).join(", ")}.`);
    L.push("");
  } else if (report.agent_skipped) {
    L.push(`## Agent scores`, "", `Skipped: ${report.agent_skipped}`, "");
  }
  L.push(`## Capability gaps by pillar`, "");
  L.push(`Blocked = no reference is possible today. Workaround = the reference only works through a client-side hack the pillar would remove.${report.agent ? " Agent = failing agent items whose transcript symptoms point at the pillar." : ""}`, "");
  L.push(`| Pillar | Blocked | Workaround | Declared (hard today)${report.agent ? " | Agent failures" : ""} | Present now? |`, `| --- | --- | --- | --- |${report.agent ? " --- |" : ""} --- |`);
  for (const [p, label] of Object.entries(GAP_PILLARS)) {
    const blocked = refs.filter((r) => r.gap && pillarOf(r.gap) === p).map((r) => r.id);
    const work = refs.filter((r) => r.workarounds.some((w) => pillarOf(w) === p)).map((r) => r.id);
    const declared = report.items.filter((i) => [...i.gaps, ...Object.values(i.blocked_keys ?? {})].some((g) => pillarOf(g) === p)).map((i) => i.id);
    const agent = report.agent ? report.agent.items.filter((x) => (x.attributed_gaps ?? []).some((g) => pillarOf(g) === p)).map((x) => x.id) : null;
    const present = report.probes[p] === undefined ? "n/a" : report.probes[p] ? "yes" : "no";
    L.push(`| ${label} | ${blocked.length} | ${work.length} | ${declared.length}${agent ? ` | ${agent.length}` : ""} | ${present} |`);
  }
  L.push("");
  L.push(`## Roadmap signal: which pillar unlocks which items`, "");
  for (const [p, label] of Object.entries(GAP_PILLARS)) {
    const tagged = report.items
      .map((i) => {
        const r = refs.find((x) => x.id === i.id);
        const tags = new Set([...i.gaps, ...Object.values(i.blocked_keys ?? {}), ...(r?.workarounds ?? []), ...(r?.gap ? [r.gap] : [])].filter((g) => pillarOf(g) === p));
        return tags.size ? `${r?.gap && pillarOf(r.gap) === p ? "**blocked** " : ""}${i.id} (${[...tags].map((t) => t.split(":")[1]).join(", ")})` : null;
      })
      .filter(Boolean);
    if (tagged.length) L.push(`- ${label}: ${tagged.join("; ")}`);
  }
  L.push("");
  L.push(`## Items`, "");
  L.push(`| Item | Tier | Drift | Reference | Calls | Workarounds / gap${report.agent ? " | Agent" : ""} |`, `| --- | --- | --- | --- | ---: | --- |${report.agent ? " --- |" : ""}`);
  for (const r of refs) {
    const a = report.agent?.items.find((x) => x.id === r.id);
    let verdict = "fail";
    if (a?.skipped) verdict = "skipped";
    else if (a?.unanswerable) verdict = a.admitted_gap ? "blocked (admitted)" : "blocked (answered anyway)";
    else if (a?.strict_pass) verdict = "pass";
    else if (a?.lenient_pass) verdict = "lenient";
    const detail = a && !a.skipped ? ` (${a.tool_calls} calls${a.attributed_gaps?.length ? `; ${a.attributed_gaps.join(", ")}` : ""})` : "";
    const agentCell = a ? ` | ${verdict}${detail}` : report.agent ? " | n/a" : "";
    const gapCell = [r.gap ? `**${r.gap}**` : null, ...r.workarounds, r.error ? `error: ${r.error.slice(0, 120).replace(/\|/g, "/")}` : null].filter(Boolean).join("; ");
    L.push(`| ${r.id} | ${r.tier} | ${r.drift} | ${r.status} | ${r.calls.length} | ${gapCell}${agentCell} |`);
  }
  L.push("");
  return L.join("\n");
}

// ---------------- main ----------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.url && !existsSync("dist/src/cli.js")) {
    console.error("eval:multistep: dist/src/cli.js is missing; run `npm run build` first.");
    process.exit(1);
  }
  const selected = items.filter((i) => (!opts.only || opts.only.has(i.id)) && (!opts.tier || i.tier === opts.tier));
  const client = await connect({ url: opts.url });
  const catalogue = await loadCatalogue(client);
  const probes = pillarProbes(catalogue);
  const pinned = loadPinned();
  const report = { run_at: new Date().toISOString(), as_of: AS_OF_DATE, items: selected, server: opts.url ?? "stdio dist/src/cli.js", git_sha: gitSha(), mode: opts.mode, probes, references: [] };

  console.log(`eval:multistep: ${selected.length} items against ${report.server}`);
  for (const item of selected) {
    const r = await runReference(client, catalogue, probes, item, pinned, opts);
    report.references.push(r);
    console.log(`  ${r.status.padEnd(22)} ${item.id}${r.gap ? ` [${r.gap}]` : ""}${r.error ? `  ${r.error.slice(0, 160)}` : ""}`);
  }

  const endpoint = opts.mode === "agent" ? chatEndpoint() : null;
  if (opts.mode === "agent" && !endpoint) {
    report.agent_skipped = "no model key (set OPENAI_API_KEY, or AZURE_API_KEY with AZURE_API_HOST and AZURE_DEPLOYMENT)";
    console.log(`eval:multistep: agent run skipped: ${report.agent_skipped}`);
  }
  if (opts.mode === "oracle" || endpoint) {
    const { tools } = await client.listTools();
    const instructions = client.getInstructions?.() ?? "";
    const sourceOfOp = new Map();
    // Typed tools (toolsets surface) map back to their source through the catalogue listing.
    const cat = await client.callTool({ name: "ireland_catalogue", arguments: {} });
    const catJson = cat.structuredContent ?? JSON.parse(cat.content[0].text);
    for (const d of catJson.domains ?? []) for (const s of d.sources ?? []) for (const op of s.operations ?? []) sourceOfOp.set(op, s.id);
    report.model = endpoint?.label ?? "oracle (references replayed as answers)";
    report.agent = { items: [] };
    for (const item of selected) {
      const ref = report.references.find((r) => r.id === item.id);
      const base = { id: item.id, tier: item.tier, control: Boolean(item.control), reference_status: ref.status };
      const answerable = ["ok", "changed"].includes(ref.status);
      // A stable or slow item whose recompute hit an upstream outage is still scored against its pin.
      const fallback = !answerable && item.drift !== "live" && ref.status !== "gap" ? pinned.items[item.id]?.expected : null;
      if (opts.mode === "oracle" && !answerable) continue;
      if (!answerable && !fallback && ref.status !== "gap") {
        report.agent.items.push({ ...base, skipped: `reference ${ref.status}` });
        continue;
      }
      for (let rep = 0; rep < opts.repeats; rep++) {
        let run;
        let expected = ref.expected ?? fallback ?? {};
        if (opts.mode === "oracle") {
          run = { answer: `Oracle.\n\`\`\`ANSWER_JSON\n${JSON.stringify(ref.expected)}\n\`\`\``, calls: ref.calls.map((c) => ({ name: "ireland_call", source: c.source, operation: c.operation, isError: false, truncated: c.truncated })), hitRoundCap: false };
        } else {
          try {
            run = await runAgent(client, endpoint, tools, instructions, item);
          } catch (err) {
            report.agent.items.push({ ...base, rep, error: err instanceof Error ? err.message : String(err), strict_pass: false, lenient_pass: false, key_fraction: 0, tool_calls: 0, sources_cited_in_trace: false, attributed_gaps: ["harness:error"] });
            continue;
          }
          if (item.drift === "live") {
            const after = await runReference(client, catalogue, probes, item, pinned, opts);
            if (after.expected) expected = Object.fromEntries(Object.keys(item.answer).map((k) => [k, { any: [ref.expected?.[k], after.expected[k]].filter((v) => v !== undefined) }]));
          }
        }
        if (ref.status === "gap") {
          const symptoms = failureSymptoms({ calls: run.calls, answer: run.answer, hitRoundCap: run.hitRoundCap });
          report.agent.items.push({ ...base, rep, strict_pass: false, lenient_pass: false, key_fraction: 0, tool_calls: run.calls.length, sources_cited_in_trace: false, unanswerable: true, admitted_gap: symptoms.includes("declared-unavailable"), symptoms, attributed_gaps: ref.gap ? [ref.gap] : ["unattributed"] });
          continue;
        }
        report.agent.items.push({ ...base, rep, ...scoreRun(item, expected, run, sourceOfOp), answer_tail: run.answer.slice(-600) });
      }
      if (opts.mode === "agent") console.log(`  agent ${report.agent.items.at(-1)?.strict_pass ? "pass" : "fail"} ${item.id}`);
    }
  }
  await client.close();

  await mkdir(opts.out, { recursive: true });
  const stamp = report.run_at.slice(0, 10);
  const serialisable = { ...report, items: selected.map((i) => i.id) };
  await writeFile(`${opts.out}/multistep-${stamp}-${opts.mode}.json`, JSON.stringify(serialisable, null, 2));
  await writeFile(`${opts.out}/multistep-${stamp}-${opts.mode}.md`, md(report));
  console.log(`eval:multistep: wrote ${opts.out}/multistep-${stamp}-${opts.mode}.{json,md}`);

  if (opts.pin) {
    const next = { as_of: stamp, server: report.server, git_sha: report.git_sha, items: { ...pinned.items } };
    for (const r of report.references) {
      if (r.status === "ok" || r.status === "changed") {
        next.items[r.id] = { tier: r.tier, drift: r.drift, retrieved: stamp, expected: r.expected, calls: r.calls.map(({ source, operation, args, url, retrieved_at }) => ({ source, operation, args, url, retrieved_at })), workarounds: r.workarounds };
      } else if (r.status === "gap") {
        next.items[r.id] = { tier: r.tier, drift: r.drift, retrieved: stamp, gap: r.gap, evidence: r.evidence };
      }
    }
    await writeFile(PINNED, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`eval:multistep: pinned ${Object.keys(next.items).length} references to evals/multistep/references.json`);
  }

  const errors = report.references.filter((r) => r.status === "reference_error");
  if (errors.length && process.env.GITHUB_ACTIONS) for (const e of errors) console.log(`::warning title=multistep reference error::${e.id}: ${e.error}`);
  if (opts.strict && errors.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
