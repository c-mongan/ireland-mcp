import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const workflow = readFileSync(new URL('../.github/workflows/deploy-legal.yml', import.meta.url), 'utf8');

test('production legal rollout excludes pull-request events and limits OIDC to its main-only job', () => {
  assert.doesNotMatch(workflow, /^\s*pull_request(?:_target)?:/m);
  assert.match(workflow, /^\s*workflow_dispatch:/m);
  assert.match(workflow, /^\s*branches:\s*\[main\]/m);
  assert.doesNotMatch(workflow.slice(0, workflow.indexOf('\njobs:')), /id-token:\s*write/);
  const job = workflow.slice(workflow.indexOf('\njobs:'));
  assert.match(job, /if:.*github\.ref\s*==\s*'refs\/heads\/main'/);
  assert.match(job, /id-token:\s*write/);
  assert.match(job, /environment:\s*production/);
});
