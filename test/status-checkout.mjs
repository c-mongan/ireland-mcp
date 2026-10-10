import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { strict as assert } from "node:assert";
import { test } from "node:test";

const script = fileURLToPath(new URL("../scripts/status-checkout.sh", import.meta.url));
const workflow = readFileSync(new URL("../.github/workflows/status.yml", import.meta.url), "utf8");
const env = { ...process.env, GIT_AUTHOR_NAME: "Status test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "Status test", GIT_COMMITTER_EMAIL: "test@example.invalid" };

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "ireland-status-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = join(root, "remote.git");
  execFileSync("git", ["init", "--bare", "--quiet", remote], { env });
  const checkout = (name) => {
    const dir = join(root, name);
    mkdirSync(dir);
    execFileSync("git", ["init", "--quiet"], { cwd: dir, env });
    execFileSync("git", ["remote", "add", "origin", remote], { cwd: dir, env });
    return dir;
  };
  const git = (dir, ...args) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const prepare = (dir) => execFileSync("bash", [script], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
  const publish = (dir, value) => {
    writeFileSync(join(dir, "status.json"), `${value}\n`);
    git(dir, "add", "status.json");
    git(dir, "commit", "--quiet", "-m", `sample ${value}`);
    git(dir, "push", "--quiet", "origin", "HEAD:status");
    return git(dir, "rev-parse", "HEAD");
  };
  return { root, remote, checkout, git, prepare, publish };
}

test("the initial feed is created and the next sample preserves its parent", (t) => {
  const f = fixture(t);
  const first = f.checkout("first");
  f.prepare(first);
  const parent = f.publish(first, "one");
  const next = f.checkout("next");
  f.prepare(next);
  assert.equal(readFileSync(join(next, "status.json"), "utf8"), "one\n");
  f.publish(next, "two");
  assert.equal(f.git(next, "rev-parse", "HEAD^"), parent);
  assert.equal(f.git(f.remote, "rev-parse", "refs/heads/status"), f.git(next, "rev-parse", "HEAD"));
});

test("a concurrent publisher is rejected without replacing published history", (t) => {
  const f = fixture(t);
  const seed = f.checkout("seed");
  f.prepare(seed);
  f.publish(seed, "seed");
  const a = f.checkout("a");
  const b = f.checkout("b");
  f.prepare(a);
  f.prepare(b);
  const published = f.publish(a, "a");
  assert.throws(() => f.publish(b, "b"), /non-fast-forward|fetch first/);
  assert.equal(f.git(f.remote, "rev-parse", "refs/heads/status"), published);
});

test("a failed remote read stops before creating the status branch", (t) => {
  const f = fixture(t);
  const dir = f.checkout("offline");
  f.git(dir, "remote", "set-url", "origin", join(f.root, "missing.git"));
  assert.throws(() => f.prepare(dir));
  assert.equal(f.git(dir, "branch", "--list", "status"), "");
});

test("the workflow publishes without rewriting branch history", () => {
  assert.match(workflow, /scripts\/status-checkout\.sh/);
  assert.match(workflow, /git push -q origin HEAD:status/);
  assert.doesNotMatch(workflow, /git push[^\n]*--force|git checkout[^\n]*--orphan/);
});
