#!/usr/bin/env node
// Refreshes or checks the Citizens Information Board (CIB) Data Hub snapshots in web/data/cib/.
// Downloads every cited official file, recomputes SHA-256, re-parses the tables and verifies that every
// pinned figure appears verbatim in the file it cites. Any mismatch exits non-zero.
//
// Usage:
//   node scripts/refresh-cib-snapshot.mjs            # check: committed snapshots must match the live files
//   node scripts/refresh-cib-snapshot.mjs --write    # rewrite the snapshots after reviewing the diff
//   add --evidence to print every verified figure with its source URL
// Not used by hosted requests: the MCP server only reads the committed JSON.
import { readFile, rename, writeFile } from "node:fs/promises";
import { buildCibSnapshots, CIB_HOST, CIB_SOURCES, comparable } from "./lib/cib.mjs";

const args = new Set(process.argv.slice(2));
const write = args.has("--write");
const MAX_BYTES = 10 * 1024 * 1024;
const outDir = new URL("../web/data/cib/", import.meta.url);

async function download(source) {
  const url = new URL(source.url);
  if (url.protocol !== "https:" || url.hostname !== CIB_HOST) throw new Error(`Refusing non-CIB URL ${source.url}`);
  const response = await fetch(url, { headers: { "user-agent": "ireland-mcp snapshot refresh (+https://github.com/c-mongan/ireland-mcp)" }, redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${source.url} returned HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new Error(`${source.url} returned ${bytes.length} bytes`);
  return bytes;
}

const files = new Map();
for (const source of CIB_SOURCES) files.set(source.id, { bytes: await download(source) });
const asOf = new Date().toISOString().slice(0, 10);
const documents = buildCibSnapshots(files, asOf);

let figures = 0;
const evidence = [];
for (const [name, doc] of Object.entries(documents)) {
  const visit = (node, path) => {
    if (Array.isArray(node)) return node.forEach((v, i) => visit(v, `${path}[${i}]`));
    if (!node || typeof node !== "object") return;
    if (typeof node.printed === "string") {
      figures++;
      evidence.push(`${path}\t${node.printed}\t${doc.sources.find((s) => s.id === node.source)?.url}`);
    }
    for (const [k, v] of Object.entries(node)) if (k !== "sources") visit(v, `${path}.${k}`);
  };
  visit(doc.years, name.replace(/\.json$/, ""));
}
if (args.has("--evidence")) console.log(evidence.join("\n"));

const drift = [];
for (const [name, doc] of Object.entries(documents)) {
  const target = new URL(name, outDir);
  if (write) {
    const temporary = new URL(`${name}.${process.pid}.tmp`, outDir);
    await writeFile(temporary, `${JSON.stringify(doc, null, 2)}\n`, { flag: "wx" });
    await rename(temporary, target);
    continue;
  }
  let committed;
  try {
    committed = JSON.parse(await readFile(target, "utf8"));
  } catch {
    drift.push(`${name}: missing or unreadable`);
    continue;
  }
  if (comparable(committed) !== comparable(doc)) {
    const changed = doc.sources.filter((s) => committed.sources?.find((c) => c.id === s.id)?.sha256 !== s.sha256).map((s) => `${s.id} (${s.url})`);
    drift.push(`${name}: differs from the official files${changed.length ? `; changed or new files: ${changed.join(", ")}` : ""}`);
  }
}
if (drift.length) {
  console.error(`CIB snapshot check FAILED:\n${drift.join("\n")}\nReview the publisher changes, then rerun with --write.`);
  process.exit(1);
}
console.log(`${write ? "Wrote" : "Checked"} ${Object.keys(documents).length} CIB snapshots: ${CIB_SOURCES.length} files hashed, ${figures} figures found verbatim in their cited files.`);
