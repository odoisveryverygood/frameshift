/** Check recorded spatial provenance and actual challenge outcomes, without model calls. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {ROOT} from '../server/core.mjs';
const [runId,challengeId]=process.argv.slice(2);
if(![runId,challengeId].every(id=>/^[a-zA-Z0-9-]{1,80}$/.test(id||'')))throw Error('Usage: node scripts/verify-spatial-run.mjs OPTIMIZE_RUN CHALLENGE_RUN');
const read=async name=>JSON.parse(await fs.readFile(name,'utf8'));
const run=await read(path.join(ROOT,'.frameshift/runs',runId,'run.json'));
const challenge=await read(path.join(ROOT,'.frameshift/runs',challengeId,'run.json'));
const exp=run.experiments.findLast(e=>e.status==='accepted');
assert.equal(run.status,'completed');assert.ok(exp);assert.equal(run.agents.investigator,'gemini');assert.equal(exp.investigation.model,'gemini-4-argon');
assert.ok(exp.investigation.trace.some(t=>t.tool==='read_source'));assert.ok(exp.investigation.trace.some(t=>t.tool==='submit_finding'));
const captured=await fs.readFile(path.join(ROOT,'.frameshift/projects',run.projectId,'spatial',run.findingId+'.png'));
assert.equal(crypto.createHash('sha256').update(captured).digest('hex'),exp.investigation.screenshotSha256);
assert.ok(exp.investigation.selectedIds.includes(exp.investigation.context.selectedId));
assert.equal(challenge.projectId,run.projectId);assert.equal(challenge.status,'completed');assert.equal(challenge.challengeResult.status,'passed');
assert.equal(challenge.challenge.expectedSelection,challenge.challengeResult.observed.reference);
assert.equal(challenge.challenge.expectedSelection,challenge.challengeResult.observed.candidate);
assert.ok(challenge.challenge.scenario.events.some(e=>e.type==='click'));
assert.ok(challenge.challengeResult.statePass&&challenge.challengeResult.applicationStatePass);
assert.ok(Object.keys(challenge.challengeResult.implementations).length>=5);
for(const [name,artifact] of Object.entries(challenge.challengeResult.artifacts)){
 const bytes=await fs.readFile(path.join(ROOT,'.frameshift/runs',challengeId,name));assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),artifact.sha256);
}
console.log(JSON.stringify({passed:true,runId,challengeId,investigator:run.agents.investigator,model:exp.investigation.model,calls:{reference:exp.reference.calls,candidate:exp.candidate.calls},checkpoints:exp.guards.checks.length,recordedTarget:challenge.challenge.expectedSelection,scope:'One authored warehouse; live Argon/Meta/SubQ, local Fetch and actual recorded selection replay. Public discovery unverified.'},null,2));
