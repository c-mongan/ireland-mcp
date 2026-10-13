/** Fail-closed decisions. These functions never execute review text or write GitHub state. */
export function mergeGate(receipt, state) {
  const reasons = [];
  if (receipt?.status !== 'complete' || receipt?.reviewer !== 'codex' || !Array.isArray(receipt?.findings) || receipt.findings.length !== 0) reasons.push('Review is incomplete or has findings.');
  if (!/^[a-f0-9]{40}$/.test(receipt?.base ?? '') || !/^[a-f0-9]{40}$/.test(receipt?.head ?? '') || receipt.head !== state?.head || receipt.head !== state?.localHead || receipt.base !== state?.base) reasons.push('Review does not match the current base and head.');
  if (!Array.isArray(receipt?.checks) || receipt.checks.length === 0 || receipt.checks.some(c => c.passed !== true || c.head !== receipt.head)) reasons.push('Local checks have not passed at the reviewed head.');
  if (![null, '', 'APPROVED'].includes(state?.reviewDecision)) reasons.push('GitHub review approval is missing, blocking, or unknown.');
  if (state?.dirty !== false || state?.sameRepository !== true || state?.draft !== false || state?.mergeable !== true || state?.requiredChecksPassed !== true || state?.unresolvedThreads !== 0 || state?.changesRequested !== false) reasons.push('PR state is not ready to merge.');
  return { allowed: reasons.length === 0, reasons };
}

export function safePath(path) {
  return typeof path === 'string' && path.length > 0 && !path.startsWith('/') && !path.includes(':') && !path.includes('\\') && !path.split('/').some(p => p === '..' || p === '.' || p === '.git' || p === '') && ![...path].some(character => character.charCodeAt(0) < 32);
}
function scope(paths, allowed) {
  return Array.isArray(paths) && paths.every(p => safePath(p) && allowed.includes(p));
}
function passed(checks, head) {
  return Array.isArray(checks) && checks.length > 0 && checks.every(c => c.passed === true && c.head === head);
}
export function validateReview(review, state, allowedPaths) {
  if (review?.status !== 'complete' || review?.reviewer !== 'codex' || review?.base !== state.base || review?.head !== state.head || !Array.isArray(review?.findings)) return false;
  return review.findings.every(f => typeof f.id === 'string' && typeof f.title === 'string' && typeof f.detail === 'string' && ['P0', 'P1', 'P2', 'P3'].includes(f.severity) && Number.isInteger(f.line) && f.line > 0 && scope([f.path], allowedPaths));
}

/** runner contains trusted adapters, supplied by the host. Review output is data only. */
export async function runLoop({ allowedPaths, maxRounds = 3 }, runner) {
  if (!Array.isArray(allowedPaths) || allowedPaths.length === 0 || !allowedPaths.every(safePath) || !Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 10) throw new Error('Invalid loop scope or round limit.');
  const rounds = [];
  const pause = reason => ({ status: 'paused', reason, rounds });
  for (let round = 1; round <= maxRounds; round++) {
    const before = await runner.snapshot();
    if (before.sameRepository !== true || before.dirty !== false || before.head !== before.localHead || !scope(before.changedPaths, allowedPaths)) return pause('Use a clean same-repository PR with only allowed paths.');
    const checks = await runner.check(before);
    if (!passed(checks, before.head)) return pause('Checks failed before review.');
    const review = await runner.review(before);
    const after = await runner.snapshot();
    if (after.head !== before.head || after.localHead !== before.localHead || after.base !== before.base || after.dirty !== false || after.sameRepository !== true || !scope(after.changedPaths, allowedPaths)) return pause('Repository changed during review.');
    if (!validateReview(review, before, allowedPaths)) return pause('Review is incomplete, stale, malformed, or outside scope.');
    const receipt = { ...review, checks };
    rounds.push(receipt);
    if (review.findings.length === 0) {
      const gate = mergeGate(receipt, after);
      return gate.allowed ? { status: 'ready_to_merge', receipt, rounds } : pause(gate.reasons.join(' '));
    }
    if (round === maxRounds) return pause('Round limit reached with findings. Repair and run a fresh review.');
    const repair = await runner.repair({ review, allowedPaths, state: before });
    if (!scope(repair?.changedPaths, allowedPaths) || repair.changedPaths.length === 0) return pause('Repair changed no files or changed a path outside scope.');
    const repaired = await runner.snapshot();
    if (repaired.head !== before.head || repaired.localHead !== before.localHead || repaired.base !== before.base || repaired.sameRepository !== true || !scope(repaired.changedPaths, allowedPaths)) return pause('Repair changed Git history, PR identity, or scope.');
    if (!passed(await runner.check(repaired), before.head)) return pause('Repair checks failed. Do not publish.');
    const tested = await runner.snapshot();
    if (tested.head !== repaired.head || tested.localHead !== repaired.localHead || tested.base !== repaired.base || tested.sameRepository !== true || !scope(tested.changedPaths, allowedPaths) || typeof repaired.worktreeDigest !== 'string' || tested.worktreeDigest !== repaired.worktreeDigest) return pause('Repository changed during repair checks or worktree digest is missing.');
    await runner.publish({ state: repaired, allowedPaths, review });
    const published = await runner.snapshot();
    if (published.head === before.head || published.head !== published.localHead || published.dirty !== false || published.base !== before.base || published.sameRepository !== true || !scope(published.changedPaths, allowedPaths)) return pause('Publication did not produce a clean new PR head.');
  }
  return pause('Review has not completed.');
}
