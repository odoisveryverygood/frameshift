/** Verify recorded live pipeline evidence without making model calls. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { ROOT } from '../server/core.mjs';
const id = process.argv[2];
if (!/^[a-zA-Z0-9-]{1,80}$/.test(id || '')) throw Error('Usage: node scripts/verify-specialist-run.mjs RUN_ID');
const dir = path.join(ROOT, '.frameshift/runs', id);
const read = async p => JSON.parse(await fs.readFile(p, 'utf8'));
const run = await read(path.join(dir, 'run.json'));
assert.equal(run.sponsorMode, true);
assert.equal(run.status, 'completed');
const checked = [];
for (const exp of run.experiments) {
  assert.ok(['meta','gemini'].includes(exp.investigation?.provider));
  assert.ok(exp.investigation.evidence.length);
  assert.equal(exp.model, process.env.META_MODEL || 'muse-spark-1.3');
  assert.equal(exp.riskAssessment?.provider, 'Subquadratic');
  assert.equal(exp.riskAssessment.mode, 'live');
  const evidence = path.join(dir, exp.id);
  const plan = await read(path.join(evidence, 'verification-plan.json'));
  assert.ok(plan.config.checkpoints.length >= run.config.checkpoints.length);
  const ref = await read(path.join(evidence, 'reference-states.json'));
  const candidate = await read(path.join(evidence, 'candidate-states.json'));
  assert.equal(ref.states.length, plan.config.checkpoints.length);
  assert.equal(candidate.states.length, plan.config.checkpoints.length);
  const receipt = await read(path.join(evidence, 'verdict.json'));
  assert.equal(receipt.policyHash, plan.seal.hash);
  for (const [name, artifact] of Object.entries(receipt.artifacts)) {
    const hash = crypto.createHash('sha256').update(await fs.readFile(path.join(evidence, name))).digest('hex');
    assert.equal(hash, artifact.sha256, `Artifact changed: ${name}`);
  }
  const lastAttempt = Math.max(...exp.handoffs.map(h => h.attempt));
  const hops = exp.handoffs.filter(h => h.attempt === lastAttempt);
  assert.deepEqual(hops.map(h=>h.stage), ['InvestigationReady','PatchReady','VerificationResult']);
  assert.ok(hops.every(h=>h.mode === 'local-in-process-uagents-dispatch' && h.sourceHash === hops[0].sourceHash));
  assert.equal(hops[1].candidateHash, hops[2].candidateHash);
  assert.equal(receipt.verdict.status, exp.status);
  checked.push({experiment:exp.id, verdict:exp.status, guards:exp.guards.pass, checkpoints:ref.states.length, added:plan.config.subqVerification.addedCheckpoints, calls:{reference:exp.reference.calls,candidate:exp.candidate.calls}});
}
assert.ok(checked.length);
console.log(JSON.stringify({runId:id,passed:true,scope:'Recorded live model specialists/SubQ and local Fetch pipeline; no public discovery claim',experiments:checked},null,2));
