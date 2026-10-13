import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewCommand } from './commands.mjs';
import { codexEnvironment, isOutsideRepository } from './safety.mjs';
import { validateReview } from './coordinator.mjs';

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 30_000 });
  if (result.status !== 0) throw new Error('Git inspection failed.');
  return result.stdout.trim();
}
function snapshot(cwd) {
  return { head: git(cwd, ['rev-parse', 'HEAD']), dirty: git(cwd, ['status', '--porcelain']).length !== 0 };
}

/** Review a clean local commit. No test, commit, push, PR, or merge is performed. */
export function localReview({ cwd, base, head, output, allowedPaths }) {
  const root = git(cwd, ['rev-parse', '--show-toplevel']);
  cwd = resolve(root);
  output = resolve(output);
  if (!isOutsideRepository(cwd, output)) throw new Error('Keep review receipts outside the repository.');
  if (existsSync(output)) throw new Error('Use a fresh receipt path. Do not reuse a previous review.');
  const schema = fileURLToPath(new URL('./review.schema.json', import.meta.url));
  const command = reviewCommand({ cwd, base, head, schema, output });
  for (const sha of [base, head]) if (git(cwd, ['rev-parse', `${sha}^{commit}`]) !== sha) throw new Error('Commit is not available locally.');
  const before = snapshot(cwd);
  if (before.head !== head || before.dirty) throw new Error('Review requires a clean checkout at the selected head.');
  const paths = git(cwd, ['diff', '--name-only', '-z', `${base}...${head}`]).split('\0').filter(Boolean);
  if (paths.some(path => !allowedPaths.includes(path))) throw new Error('PR contains a path outside the allowed scope.');
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  const result = spawnSync(command.file, command.args, { cwd, env: codexEnvironment(), input: command.input, stdio: ['pipe', 'ignore', 'ignore'], timeout: 15 * 60_000 });
  if (result.status !== 0) throw new Error('Codex did not complete. Receipt is not a review pass.');
  const after = snapshot(cwd);
  if (after.head !== head || after.dirty) throw new Error('Checkout changed during review.');
  chmodSync(output, 0o600);
  const review = JSON.parse(readFileSync(output, 'utf8'));
  if (!validateReview(review, { base, head }, allowedPaths)) throw new Error('Review is incomplete, malformed, stale, or outside scope.');
  return review;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [base, head, output, scopeFile] = process.argv.slice(2);
    if (!scopeFile) throw new Error('Usage: node scripts/review-loop/local-review.mjs BASE_SHA HEAD_SHA OUTPUT_JSON SCOPE_JSON');
    const allowedPaths = JSON.parse(readFileSync(resolve(scopeFile), 'utf8'));
    if (!Array.isArray(allowedPaths) || allowedPaths.length === 0 || allowedPaths.some(p => typeof p !== 'string')) throw new Error('Scope must be a nonempty JSON array of task paths.');
    const review = localReview({ cwd: process.cwd(), base, head, output, allowedPaths });
    console.log(JSON.stringify({ status: review.status, base: review.base, head: review.head, findingCount: review.findings.length, receipt: resolve(output) }));
    process.exitCode = review.findings.length ? 2 : 0;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
