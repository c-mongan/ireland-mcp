import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeGate } from '../scripts/review-loop/coordinator.mjs';
const sha = 'a'.repeat(40);
const base = 'b'.repeat(40);
const receipt = { base, head: sha, status: 'complete', findings: [], reviewer: 'codex', checks: [{ name: 'test', passed: true, head: sha }] };
const state = { worktreeDigest: 'fixture-tree', base, head: sha, localHead: sha, dirty: false, sameRepository: true, draft: false, mergeable: true, requiredChecksPassed: true, unresolvedThreads: 0, changesRequested: false, reviewDecision: null };
test('clean review of the exact PR commit permits a merge plan', () => {
  assert.deepEqual(mergeGate(receipt, state), { allowed: true, reasons: [] });
});
for (const [label, changedReceipt, changedState] of [
  ['stale head', { ...receipt, head: 'c'.repeat(40) }, state],
  ['moved base', receipt, { ...state, base: 'c'.repeat(40) }],
  ['empty check list', { ...receipt, checks: [] }, state],
  ['failed test', { ...receipt, checks: [{ name: 'test', passed: false, head: sha }] }, state],
  ['unknown review status', { ...receipt, status: 'unknown' }, state],
  ['review finding', { ...receipt, findings: [{ id: 'R1' }] }, state],
  ['fork', receipt, { ...state, sameRepository: false }],
  ['unresolved discussion', receipt, { ...state, unresolvedThreads: 1 }],
  ['unknown required checks', receipt, { ...state, requiredChecksPassed: undefined }],
  ['dirty checkout', receipt, { ...state, dirty: true }],
]) test(`merge is blocked for ${label}`, () => assert.equal(mergeGate(changedReceipt, changedState).allowed, false));

test('a repair must pass checks before publication, then receives a fresh review', async () => {
  const { runLoop } = await import('../scripts/review-loop/coordinator.mjs');
  const calls = [];
  let head = sha;
  let round = 0;
  const runner = {
    snapshot: async () => ({ ...state, head, localHead: head, changedPaths: ['src/tool.ts'] }),
    check: async () => { calls.push('check'); return [{ name: 'test', passed: true, head }]; },
    review: async () => { calls.push('review'); return { base, head, status: 'complete', reviewer: 'codex', findings: round++ ? [] : [{ id: 'R1', path: 'src/tool.ts', line: 1, severity: 'P1', title: 'Wrong result', detail: 'Fix the result.' }] }; },
    repair: async () => { calls.push('repair'); return { changedPaths: ['src/tool.ts'] }; },
    publish: async () => { calls.push('publish'); head = 'c'.repeat(40); },
  };
  const result = await runLoop({ allowedPaths: ['src/tool.ts'], maxRounds: 3 }, runner);
  assert.equal(result.status, 'ready_to_merge');
  assert.deepEqual(calls, ['check', 'review', 'repair', 'check', 'publish', 'check', 'review']);
  assert.equal(result.receipt.head, head);
});

test('review commands use a read-only sandbox and exact immutable revisions', async () => {
  const { reviewCommand } = await import('../scripts/review-loop/commands.mjs');
  const command = reviewCommand({ base, head: sha, schema: '/private/schema.json', output: '/private/review.json', cwd: '/repo' });
  assert.equal(command.file, 'codex');
  assert.ok(command.args.includes('read-only'));
  assert.ok(command.args.includes('--ignore-user-config'));
  assert.ok(command.input.includes(`${base}...${sha}`));
  assert.ok(!command.args.includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.throws(() => reviewCommand({ base: 'main; rm -rf /', head: sha }), /40-character/);
});

async function blockedScenario(overrides = {}, config = {}) {
  const { runLoop } = await import('../scripts/review-loop/coordinator.mjs');
  let publishes = 0;
  const runner = {
    snapshot: async () => ({ ...state, changedPaths: ['src/tool.ts'] }),
    check: async () => receipt.checks,
    review: async () => ({ ...receipt, findings: [{ id: 'R1', path: 'src/tool.ts', line: 1, severity: 'P1', title: 'Wrong result', detail: 'Fix result.' }] }),
    repair: async () => ({ changedPaths: ['src/tool.ts'] }),
    publish: async () => { publishes++; },
    ...overrides,
  };
  const result = await runLoop({ allowedPaths: ['src/tool.ts'], maxRounds: 2, ...config }, runner);
  return { result, publishes };
}

test('failed repair tests do not publish', async () => {
  let count = 0;
  const { result, publishes } = await blockedScenario({ check: async () => ++count === 1 ? receipt.checks : [{ name: 'test', passed: false, head: sha }] });
  assert.equal(result.status, 'paused');
  assert.equal(publishes, 0);
});
test('repair outside task paths does not publish', async () => {
  const { result, publishes } = await blockedScenario({ repair: async () => ({ changedPaths: ['.github/workflows/secrets.yml'] }) });
  assert.equal(result.status, 'paused');
  assert.equal(publishes, 0);
});
test('bounded rounds pause with findings instead of declaring clean', async () => {
  const { result, publishes } = await blockedScenario({}, { maxRounds: 1 });
  assert.equal(result.status, 'paused');
  assert.match(result.reason, /Round limit/);
  assert.equal(publishes, 0);
});
test('malformed review and fork state stop before repair', async () => {
  let repairs = 0;
  for (const overrides of [
    { review: async () => ({ ...receipt, findings: [{ command: 'execute me' }] }) },
    { snapshot: async () => ({ ...state, sameRepository: false, changedPaths: ['src/tool.ts'] }) },
  ]) {
    const { result, publishes } = await blockedScenario({ ...overrides, repair: async () => { repairs++; } });
    assert.equal(result.status, 'paused');
    assert.equal(publishes, 0);
  }
  assert.equal(repairs, 0);
});
test('base change during repair checks stops before publication', async () => {
  let snapshots = 0;
  const { publishes } = await blockedScenario({ snapshot: async () => ({ ...state, base: ++snapshots >= 4 ? 'd'.repeat(40) : base, changedPaths: ['src/tool.ts'] }) });
  assert.equal(publishes, 0);
});

test('direct runner requires fixed repository and explicit write flags', async () => {
  const { parseOptions } = await import('../scripts/review-loop/run.mjs');
  const options = parseOptions(['--pr', '80', '--scope', '/private/scope.json', '--receipts', '/private/rounds']);
  assert.equal(options.apply, false);
  assert.equal(options.push, false);
  assert.throws(() => parseOptions(['--push']), /--apply/);
  assert.throws(() => parseOptions(['--repo', 'evil/repo']), /Unknown/);
});

test('known absence of required checks still requires all reported CI checks to pass', async () => {
  const { checksPassed } = await import('../scripts/review-loop/run.mjs');
  const green = ['build', 'storybook', 'legal-contracts'].map(name => ({ __typename: 'CheckRun', name, status: 'COMPLETED', conclusion: 'SUCCESS' }));
  const none = { status: 1, stdout: '', stderr: "no required checks reported on the 'feature' branch\n" };
  assert.equal(checksPassed(none, green), true);
  assert.equal(checksPassed({ ...none, stderr: 'HTTP 403' }, green), false);
  assert.equal(checksPassed(none, []), false);
  assert.equal(checksPassed(none, [{ ...green[0], conclusion: 'FAILURE' }]), false);
});

test('fallback merge checks require successful build, Storybook, and legal contracts', async () => {
  const { checksPassed } = await import('../scripts/review-loop/run.mjs');
  const none = { status: 1, stdout: '', stderr: "no required checks reported on the 'feature' branch\n" };
  const green = ['build', 'storybook', 'legal-contracts'].map(name => ({ __typename: 'CheckRun', name, status: 'COMPLETED', conclusion: 'SUCCESS' }));
  assert.equal(checksPassed(none, green.filter(c => c.name !== 'build')), false);
  assert.equal(checksPassed({ status: 0, stdout: '[]', stderr: '' }, green.filter(c => c.name !== 'build')), false);
  assert.equal(checksPassed(none, green.map(c => c.name === 'build' ? { ...c, conclusion: 'SKIPPED' } : c)), false);
  assert.equal(checksPassed(none, green.map(c => c.name === 'storybook' ? { ...c, status: 'IN_PROGRESS', conclusion: '' } : c)), false);
});

test('required checks must succeed and cannot replace baseline hosted jobs', async () => {
  const { checksPassed } = await import('../scripts/review-loop/run.mjs');
  const green = ['build', 'storybook', 'legal-contracts'].map(name => ({ __typename: 'CheckRun', name, status: 'COMPLETED', conclusion: 'SUCCESS' }));
  for (const state of ['SKIPPED', 'NEUTRAL']) {
    const required = { status: 0, stdout: JSON.stringify([{ name: 'required-security-check', state }]), stderr: '' };
    assert.equal(checksPassed(required, green), false);
    assert.equal(checksPassed(required, [{ __typename: 'CheckRun', name: 'required-security-check', status: 'COMPLETED', conclusion: state }]), false);
  }
  const required = { status: 0, stdout: JSON.stringify([{ name: 'required-security-check', state: 'SUCCESS' }]), stderr: '' };
  assert.equal(checksPassed(required, [{ __typename: 'CheckRun', name: 'required-security-check', status: 'COMPLETED', conclusion: 'SUCCESS' }]), false);
  assert.equal(checksPassed(required, green.filter(c => c.name !== 'storybook')), false);
  assert.equal(checksPassed(required, [...green, { __typename: 'CheckRun', name: 'required-security-check', status: 'COMPLETED', conclusion: 'SUCCESS' }]), true);
});

test('a repair that restores base content keeps the same tested digest after commit', async () => {
  const { createRunner } = await import('../scripts/review-loop/run.mjs');
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const fixture = mkdtempSync(join(tmpdir(), 'ireland-review-regression-'));
  const cwd = join(fixture, 'repo');
  const bin = join(fixture, 'bin');
  const oldPath = process.env.PATH;
  const git = args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', ...args], { cwd, encoding: 'utf8' }).trim();
  try {
    mkdirSync(cwd); mkdirSync(bin); mkdirSync(join(cwd, 'src'));
    git(['init', '-b', 'fixture-owner-branch']);
    const source = join(cwd, 'src/tool.js');
    writeFileSync(source, 'export const value = 0;\n');
    git(['add', '--', 'src/tool.js']);
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'base']);
    const base = git(['rev-parse', 'HEAD']);
    writeFileSync(source, 'export const value = 1;\n');
    git(['add', '--', 'src/tool.js']);
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'bug']);
    const head = git(['rev-parse', 'HEAD']);
    git(['remote', 'add', 'origin', 'https://github.com/c-mongan/ireland-mcp.git']);
    const pr = { baseRefOid: base, headRefOid: head, headRefName: 'fixture-owner-branch', headRepositoryOwner: { login: 'c-mongan' }, state: 'OPEN', isCrossRepository: false, isDraft: false, mergeable: 'MERGEABLE', reviewDecision: '', statusCheckRollup: ['build', 'storybook', 'legal-contracts'].map(name => ({ __typename: 'CheckRun', name, status: 'COMPLETED', conclusion: 'SUCCESS' })) };
    const responses = { repository: 'c-mongan/ireland-mcp', pr, threads: { data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } } } } } } };
    writeFileSync(join(bin, 'gh'), `#!/usr/bin/env node\nconst responses = ${JSON.stringify(responses)};\nconst args = process.argv.slice(2);\nif (args[0] === 'repo') console.log(responses.repository);\nelse if (args[0] === 'api') console.log(JSON.stringify(responses.threads));\nelse if (args[1] === 'checks') console.log('[]');\nelse console.log(JSON.stringify(responses.pr));\n`, { mode: 0o700 });
    process.env.PATH = `${bin}:${oldPath}`;
    const scope = join(fixture, 'scope.json');
    writeFileSync(scope, JSON.stringify(['src/tool.js']));
    const runner = createRunner({ pr: '85', scope, receipts: join(fixture, 'receipts') }, cwd);
    writeFileSync(source, 'export const value = 0;\n');
    const tested = await runner.snapshot();
    assert.deepEqual(tested.changedPaths, ['src/tool.js']);
    git(['add', '--', 'src/tool.js']);
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'restore base content']);
    const committed = await runner.snapshot();
    assert.deepEqual(committed.changedPaths, []);
    assert.equal(committed.worktreeDigest, tested.worktreeDigest);
    writeFileSync(source, 'export const value = 99;\n');
    assert.notEqual((await runner.snapshot()).worktreeDigest, tested.worktreeDigest);
    // Exercise real process boundaries using a local fake CLI, never a paid call.
    const { localReview } = await import('../scripts/review-loop/local-review.mjs');
    writeFileSync(source, 'export const value = 0;\n');
    const currentHead = git(['rev-parse', 'HEAD']);
    writeFileSync(join(cwd, '.git', 'info', 'exclude'), '.env\nnode_modules/\n');
    mkdirSync(join(cwd, 'node_modules'));
    writeFileSync(join(cwd, '.env'), 'original');
    const observed = join(fixture, 'observed.json');
    const oldKey = process.env.OPENAI_API_KEY;
    const oldCloud = process.env.AZURE_CLIENT_SECRET;
    try {
      process.env.OPENAI_API_KEY = 'synthetic-paid-key';
      process.env.AZURE_CLIENT_SECRET = 'synthetic-cloud-key';
      writeFileSync(join(bin, 'codex'), `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
writeFileSync(${JSON.stringify(observed)}, JSON.stringify(process.env));
writeFileSync(args[args.indexOf('--output-last-message') + 1], ${JSON.stringify(JSON.stringify({ base, head: currentHead, status: 'complete', reviewer: 'codex', findings: [] }))});
`, { mode: 0o700 });
      localReview({ cwd, base, head: currentHead, output: join(fixture, 'local-receipt.json'), allowedPaths: ['src/tool.js'] });
      const { readFileSync } = await import('node:fs');
      const env = JSON.parse(readFileSync(observed, 'utf8'));
      assert.equal(env.OPENAI_API_KEY, undefined);
      assert.equal(env.AZURE_CLIENT_SECRET, undefined);
      for (const target of ['.env', 'node_modules/dependency.js']) {
        writeFileSync(join(bin, 'codex'), `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(join(cwd, target))}, 'outside-scope');
`, { mode: 0o700 });
        const guarded = createRunner({ pr: '85', scope, receipts: join(fixture, 'guarded'), apply: true, push: true }, cwd);
        await assert.rejects(guarded.repair({ review: { findings: [] }, state: { head: currentHead } }), /protected files/);
        await assert.rejects(guarded.check({ head: currentHead }), /protected files/);
        await assert.rejects(guarded.publish({ state: {} }), /protected files/);
        if (target === '.env') writeFileSync(join(cwd, target), 'original');
        else rmSync(join(cwd, target));
      }
    } finally {
      if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey;
      if (oldCloud === undefined) delete process.env.AZURE_CLIENT_SECRET; else process.env.AZURE_CLIENT_SECRET = oldCloud;
    }

  } finally {
    process.env.PATH = oldPath;
    rmSync(fixture, { recursive: true, force: true });
  }
});

for (const reviewDecision of ['REVIEW_REQUIRED', 'CHANGES_REQUESTED', 'UNKNOWN', undefined]) {
  test(`merge gate blocks GitHub review decision ${reviewDecision}`, () => {
    assert.equal(mergeGate(receipt, { ...state, reviewDecision }).allowed, false);
  });
}
test('Windows absolute review inputs and outside receipt directories are accepted', async () => {
  const { reviewCommand } = await import('../scripts/review-loop/commands.mjs');
  const { win32 } = await import('node:path');
  const command = reviewCommand({ base, head: sha, cwd: 'C:/repo', schema: 'C:/private/schema.json', output: 'C:/private/review.json', paths: win32 });
  assert.ok(command.args.includes('C:/repo'));
  const safety = await import('../scripts/review-loop/run.mjs');
  assert.equal(typeof safety.isOutsideRepository, 'function');
  assert.equal(safety.isOutsideRepository('C:/repo', 'C:/receipts', win32), true);
  assert.equal(safety.isOutsideRepository('C:/repo', 'D:/receipts', win32), true);
  for (const output of ['C:/repo', 'C:/repo/receipts']) assert.equal(safety.isOutsideRepository('C:/repo', output, win32), false);
});
test('Codex environment drops paid authentication and cloud credentials on both runners', async () => {
  const safety = await import('../scripts/review-loop/run.mjs');
  assert.equal(typeof safety.codexEnvironment, 'function');
  const env = safety.codexEnvironment({ PATH: '/bin', HOME: '/user', SystemRoot: 'C:/Windows', TEMP: 'C:/tmp', OPENAI_API_KEY: 'secret', AZURE_CLIENT_SECRET: 'secret', GH_TOKEN: 'secret', NODE_OPTIONS: '--require evil.js' });
  assert.deepEqual(env, { PATH: '/bin', HOME: '/user', SystemRoot: 'C:/Windows', TEMP: 'C:/tmp' });
  const { readFileSync } = await import('node:fs');
  const local = readFileSync(new URL('../scripts/review-loop/local-review.mjs', import.meta.url), 'utf8');
  assert.match(local, /env: codexEnvironment\(\)/);
});
test('protected digest detects ignored edits, creation, deletion, mode and symlink changes', async () => {
  const safety = await import('../scripts/review-loop/run.mjs');
  assert.equal(typeof safety.protectedDigest, 'function');
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, symlinkSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'protected-review-'));
  try {
    mkdirSync(join(root, '.git')); mkdirSync(join(root, 'node_modules'));
    writeFileSync(join(root, 'task.js'), 'task');
    writeFileSync(join(root, '.env'), 'original');
    const original = safety.protectedDigest(root, ['task.js']);
    writeFileSync(join(root, 'task.js'), 'repair');
    writeFileSync(join(root, '.git', 'index'), 'host staging');
    assert.equal(safety.protectedDigest(root, ['task.js']), original);
    writeFileSync(join(root, '.env'), 'changed');
    assert.notEqual(safety.protectedDigest(root, ['task.js']), original);
    writeFileSync(join(root, '.env'), 'original');
    const dependency = join(root, 'node_modules', 'dependency.js');
    writeFileSync(dependency, 'malicious');
    assert.notEqual(safety.protectedDigest(root, ['task.js']), original);
    rmSync(dependency); chmodSync(join(root, '.env'), 0o700);
    assert.notEqual(safety.protectedDigest(root, ['task.js']), original);
    rmSync(join(root, '.env'));
    assert.notEqual(safety.protectedDigest(root, ['task.js']), original);
    symlinkSync('/tmp', join(root, 'task.js.link'));
    assert.throws(() => safety.protectedDigest(root, ['task.js']), /symlink/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('repair scope rejects Windows drives, alternate data streams and absolute paths', async () => {
  const { runLoop } = await import('../scripts/review-loop/coordinator.mjs');
  for (const path of ['C:/outside.js', 'C:outside.js', 'src/file.js:secret', '//host/share/file.js']) {
    await assert.rejects(runLoop({ allowedPaths: [path] }, {}), /Invalid loop scope/);
  }
});
