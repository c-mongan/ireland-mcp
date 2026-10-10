import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, rmSync, statSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

function runDeploy(t, deploymentStatus, { source = "clean", expected = "none" } = {}) {
  const fixture = mkdtempSync(join(tmpdir(), "ireland-deploy-zip-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const workspace = join(fixture, "workspace");
  const bin = join(fixture, "bin");
  const temporary = join(fixture, "temporary");
  const captured = join(fixture, "captured.zip");
  const metadata = join(fixture, "metadata.json");
  const log = join(fixture, "deploy.log");
  for (const directory of [join(workspace, "scripts"), bin, temporary]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  copyFileSync(new URL("../scripts/deploy-zip.sh", import.meta.url), join(workspace, "scripts/deploy-zip.sh"));
  for (const name of ["host.json", "package.json", "package-lock.json"]) {
    writeFileSync(join(workspace, name), "{}\n", { mode: 0o600 });
  }

  writeFileSync(join(workspace, ".gitignore"), "dist/\nnode_modules/\n", { mode: 0o600 });
  let revision = "";
  if (source !== "no-git") {
    const git = (...args) => execFileSync("git", ["-C", workspace, ...args], { encoding: "utf8" });
    git("init", "-q");
    git("config", "user.name", "Deployment fixture");
    git("config", "user.email", "fixture@example.test");
    git("add", ".gitignore", "scripts/deploy-zip.sh", "host.json", "package.json", "package-lock.json");
    git("commit", "-q", "-m", "fixture");
    revision = git("rev-parse", "HEAD").trim();
    if (source === "dirty-before") writeFileSync(join(workspace, "package.json"), '{"dirty":true}\n', { mode: 0o600 });
  }

  writeFileSync(join(bin, "npm"), `#!/usr/bin/env node
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const args = process.argv.slice(2).join(" ");
if (args === "ci") {
  mkdirSync("node_modules", { recursive: true });
} else if (args === "run build") {
  mkdirSync("dist/src/functions", { recursive: true });
  writeFileSync("dist/src/functions/mcp.js", "export {};\\n");
  mkdirSync("dist/test", { recursive: true });
  writeFileSync("dist/test/excluded.js", "must not ship\\n");
  if (process.env.FIXTURE_BUILD_CHANGE === "dirty-during") {
    writeFileSync("package.json", '{"changed":true}\\n');
  } else if (process.env.FIXTURE_BUILD_CHANGE === "head-change") {
    writeFileSync("package.json", '{"committed":true}\\n');
    execFileSync("git", ["add", "package.json"]);
    execFileSync("git", ["commit", "-q", "-m", "changed during build"]);
  }
} else if (args === "ci --omit=dev --ignore-scripts") {
  mkdirSync("node_modules/@fixture/runtime", { recursive: true });
  writeFileSync("node_modules/@fixture/runtime/index.js", "export {};\\n");
  mkdirSync("node_modules/.bin", { recursive: true });
  writeFileSync("node_modules/.bin/fixture", "#!/bin/sh\\nexit 0\\n");
  chmodSync("node_modules/.bin/fixture", 0o700);
} else {
  throw new Error("Unexpected npm arguments: " + args);
}
`);
  writeFileSync(join(bin, "az"), `#!/usr/bin/env node
import { copyFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
const args = process.argv.slice(2);
if (args.slice(0, 4).join(" ") === "functionapp deployment source config-zip") {
  const archive = args[args.indexOf("--src") + 1];
  const expected = [
    "functionapp", "deployment", "source", "config-zip",
    "-g", "fixture-rg", "-n", "fixture-app", "--src", archive, "--build-remote", "false"
  ];
  if (JSON.stringify(args) !== JSON.stringify(expected)) {
    throw new Error("Unexpected deployment arguments: " + args.join(" "));
  }
  copyFileSync(archive, process.env.CAPTURED_ZIP);
  writeFileSync(process.env.CAPTURED_METADATA, JSON.stringify({
    stage: dirname(archive),
    stageMode: statSync(dirname(archive)).mode & 0o777,
    archiveMode: statSync(archive).mode & 0o777
  }));
  process.exit(Number(process.env.DEPLOYMENT_STATUS));
} else if (args.join(" ") === "functionapp show -g fixture-rg -n fixture-app --query properties.defaultHostName -o tsv") {
  console.log("fixture-app.azurewebsites.net");
} else {
  throw new Error("Unexpected az arguments: " + args.join(" "));
}
`);
  chmodSync(join(bin, "npm"), 0o700);
  chmodSync(join(bin, "az"), 0o700);

  const result = spawnSync("bash", [
    "-c", 'umask 077; bash "$1" > "$2" 2>&1', "deploy-test",
    join(workspace, "scripts/deploy-zip.sh"), log
  ], {
    cwd: fixture,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      TMPDIR: temporary,
      RESOURCE_GROUP: "fixture-rg",
      FUNCTION_APP: "fixture-app",
      CAPTURED_ZIP: captured,
      CAPTURED_METADATA: metadata,
      DEPLOYMENT_STATUS: String(deploymentStatus),
      FIXTURE_BUILD_CHANGE: source,
      IRELAND_MCP_EXPECTED_REVISION: expected === "matching" ? revision : expected === "wrong" ? "f".repeat(40) : ""
    },
    encoding: "utf8",
    timeout: 30_000
  });
  assert.ifError(result.error);
  const output = readFileSync(log, "utf8");
  if (expected === "wrong" || (expected === "matching" && source !== "clean")) {
    assert.equal(result.status, 1, output);
    assert.match(output, /Deployment stopped: the build is not a clean checkout of the expected Git revision/);
    assert.equal(existsSync(captured), false, "revision failure must occur before Azure upload");
    assert.deepEqual(readdirSync(temporary), [], "private staging is cleaned after a provenance failure");
    return { output, revision };
  }
  assert.equal(result.status, deploymentStatus, output);
  const details = JSON.parse(readFileSync(metadata, "utf8"));
  assert.equal(details.stageMode, 0o700, "staging root must stay private");
  assert.equal(details.archiveMode, 0o600, "the local ZIP must stay private");
  assert.equal(statSync(log).mode & 0o777, 0o600, "caller logs must stay private");
  assert.equal(statSync(join(workspace, "host.json")).mode & 0o777, 0o600);
  assert.equal(statSync(join(workspace, "dist/src/functions/mcp.js")).mode & 0o777, 0o600);
  assert.equal(statSync(join(workspace, "dist")).mode & 0o777, 0o700);
  assert.equal(statSync(join(workspace, "node_modules")).mode & 0o777, 0o700);
  assert.equal(existsSync(details.stage), false, "staging must be cleaned up");
  assert.deepEqual(readdirSync(temporary), [], "no staging files may remain");
  return { captured, output, revision };
}

test("private umask produces a readable Function ZIP without broadening source or logs", (t) => {
  const { captured, output, revision } = runDeploy(t, 0, { expected: "matching" });
  assert.match(output, /Deployed to https:\/\/fixture-app\.azurewebsites\.net\/mcp/);
  const listing = execFileSync("zipinfo", ["-l", captured], { encoding: "utf8" });
  const entries = new Map();
  for (const line of listing.split("\n")) {
    const columns = line.trim().split(/\s+/);
    if (/^[d-][rwxstST-]{9}$/.test(columns[0])) {
      entries.set(columns.at(-1), columns[0]);
    }
  }
  assert.deepEqual([...entries.keys()].sort(), [
    "dist/", "dist/src/", "dist/src/functions/", "dist/src/functions/mcp.js",
    "dist/src/gateway/", "dist/src/gateway/release.js",
    "host.json", "node_modules/", "node_modules/.bin/", "node_modules/.bin/fixture",
    "node_modules/@fixture/", "node_modules/@fixture/runtime/",
    "node_modules/@fixture/runtime/index.js", "package-lock.json", "package.json"
  ].sort());
  for (const [name, mode] of entries) {
    assert.equal(mode[4], "r", `${name} must be group-readable: ${mode}`);
    assert.equal(mode[7], "r", `${name} must be world-readable: ${mode}`);
    assert.equal(mode[5], "-", `${name} must not be group-writable: ${mode}`);
    assert.equal(mode[8], "-", `${name} must not be world-writable: ${mode}`);
    if (name.endsWith("/") || name === "node_modules/.bin/fixture") {
      assert.equal(mode[3], "x", `${name} must retain owner execute permission`);
      assert.equal(mode[6], "x", `${name} must be group-traversable/executable`);
      assert.equal(mode[9], "x", `${name} must be world-traversable/executable`);
    } else {
      assert.equal(mode[3], "-", `${name} must not gain owner execute permission`);
      assert.equal(mode[6], "-", `${name} must not gain group execute permission`);
      assert.equal(mode[9], "-", `${name} must not gain world execute permission`);
    }
  }
  assert.equal(execFileSync("unzip", ["-p", captured, "dist/src/gateway/release.js"], { encoding: "utf8" }), `export const PACKAGED_RELEASE = "${revision}";\n`);
  assert.equal(execFileSync("unzip", ["-p", captured, "host.json"], { encoding: "utf8" }), "{}\n");
  assert.equal(execFileSync("unzip", ["-p", captured, "dist/src/functions/mcp.js"], { encoding: "utf8" }), "export {};\n");
});

test("failed Azure upload preserves its exit code and cleans private staging", (t) => {
  const { output } = runDeploy(t, 42);
  assert.doesNotMatch(output, /Deployed to/);
});

for (const source of ["dirty-before", "dirty-during", "head-change", "no-git"]) {
  test(`${source} packaging omits an unproved release identity`, (t) => {
    const { captured, output } = runDeploy(t, 0, { source });
    assert.match(output, /Package release identity omitted/);
    assert.equal(execFileSync("unzip", ["-p", captured, "dist/src/gateway/release.js"], { encoding: "utf8" }), "export const PACKAGED_RELEASE = undefined;\n");
  });
}

for (const options of [
  { expected: "wrong" },
  { source: "dirty-before", expected: "matching" },
  { source: "dirty-during", expected: "matching" },
  { source: "head-change", expected: "matching" }
]) {
  test(`CI rejects unproved checkout identity: ${JSON.stringify(options)}`, (t) => {
    runDeploy(t, 0, options);
  });
}
