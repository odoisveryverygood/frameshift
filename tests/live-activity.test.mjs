import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveLiveActivity} from '../src/live-activity.mjs';
const at='2026-11-07T20:00:00.000Z';
const event=(type,message=type,extra={})=>({at,type,message,...extra});
const run=(exp={},events=[])=>({status:'running',kind:'optimize',sponsorMode:true,baseline:{calls:1609},experiments:[{id:'exp2',index:2,createdAt:at,status:'reasoning',...exp}],events});
const state=(result,id)=>result.stages.find(s=>s.id===id);

test('Investigator source tools are live; earlier baseline and old experiments do not complete stages',()=>{
 const result=deriveLiveActivity(run({investigatorTrace:[{type:'agent-tool',role:'investigator',tool:'read_source',path:'src/fleet.js',message:'read_source: src/fleet.js'}]},[
  {at:'2026-11-07T19:00:00Z',type:'accepted',message:'Experiment 1 accepted'},event('investigator','Inspecting the measured bottleneck')
 ]));
 assert.equal(result.activeId,'scout');assert.equal(state(result,'scout').state,'working');
 assert.match(state(result,'scout').task,/Reading source · src\/fleet.js/);
 assert.equal(result.completedCount,0);assert.equal(state(result,'smith').state,'waiting');assert.equal(state(result,'warden').state,'waiting');
});
test('Optimizer receives actual investigation evidence and trace including rejected source tools',()=>{
 const result=deriveLiveActivity(run({investigation:{hypothesis:'Repeated robot draw submissions'},trace:[
  {type:'agent-tool',role:'optimizer',tool:'read_source',path:'src/robot.js'},
  {type:'agent-tool-result',role:'optimizer',tool:'submit_patch',status:'rejected',message:'Protected verifier file cannot be edited'}
 ]},[event('optimizer','Implementing a focused patch')]));
 assert.equal(result.activeId,'gauge');assert.equal(state(result,'scout').state,'done');
 assert.equal(state(result,'smith').state,'waiting');assert.equal(state(result,'warden').state,'waiting');
 assert.match(state(result,'gauge').task,/Rejected · submit_patch/);
 assert.ok(result.activity.some(e=>e.rejected&&e.text.includes('Protected verifier file')));
});
test('persisted optimizer tool successes are displayed as results rather than repeated pending calls',()=>{
 const result=deriveLiveActivity(run({trace:[{at,tool:'read_source',path:'src/robot.js',ok:true}]},[event('optimizer')]));
 assert.match(result.activity.at(-1).text,/Completed · read_source · src\/robot.js/);
});
test('SubQ waits before request, works after request, completes only on assessment',()=>{
 let result=deriveLiveActivity(run({status:'building',investigation:{},files:['src/robot.js']},[event('optimizer')]));
 assert.equal(result.activeId,'gauge');assert.equal(state(result,'smith').state,'waiting');
 result=deriveLiveActivity(run({status:'building',investigation:{}},[event('verifier','Verifier: assessing patch risks with Subquadratic')]));
 assert.equal(result.activeId,'smith');assert.equal(state(result,'smith').state,'working');assert.equal(state(result,'warden').state,'waiting');
 result=deriveLiveActivity(run({status:'building',investigation:{},riskAssessment:{provider:'Subquadratic',assessedAt:at,probabilities:{picking:.7}}},[event('verifier'),event('build','Building production bundle')]));
 assert.equal(result.activeId,'gauge');assert.equal(state(result,'smith').state,'done');assert.equal(state(result,'warden').state,'waiting');
});
test('visual guards passing does not finish the verifier while benchmarks remain',()=>{
 const result=deriveLiveActivity(run({status:'benchmarking',previewReady:true,investigation:{},riskAssessment:{provider:'Subquadratic'},guards:{pass:true,checks:[{visualPass:true,statePass:true,pickingPass:true}] }},[event('benchmark','Sequential reference and candidate benchmarks')]));
 assert.equal(result.activeId,'warden');assert.equal(state(result,'warden').state,'working');
 assert.equal(result.completedCount,3);assert.match(result.detail,/final verdict pending/);
});
test('only executed guard evidence plus deterministic verdict complete all four stages',()=>{
 const result=deriveLiveActivity({...run({status:'accepted',previewReady:true,investigation:{},riskAssessment:{provider:'Subquadratic'},guards:{pass:true},verifier:{artifact:'verdict.json'},reason:'Draw calls reduced'},[event('accepted'),event('complete')]),status:'completed'});
 assert.equal(result.completedCount,4);assert.equal(result.activeId,null);assert.equal(state(result,'warden').state,'done');
});
test('terminal status alone cannot mark every stage complete',()=>{
 const result=deriveLiveActivity({...run({status:'accepted'},[event('complete')]),status:'completed'});
 assert.equal(result.completedCount,0);assert.equal(result.activeId,null);assert.equal(state(result,'warden').state,'waiting');
});
test('SubQ request failure marks Oracle failed, not done or active',()=>{
 const result=deriveLiveActivity({...run({status:'failed',investigation:{},files:['src/robot.js']},[event('optimizer'),event('verifier','Assessing patch risks'),event('error','SubQ unavailable')]),status:'failed',error:'SubQ unavailable'});
 assert.equal(result.activeId,null);assert.equal(state(result,'smith').state,'failed');assert.match(state(result,'smith').task,/SubQ unavailable/);assert.equal(state(result,'warden').state,'waiting');
});
test('optimizer provider failure remains visible and does not complete unrun verification',()=>{
 const result=deriveLiveActivity({...run({status:'failed',investigation:{},trace:[{type:'agent-provider-response',role:'optimizer',provider:'meta',status:'failed',message:'Provider returned no tool call'}]},[event('optimizer'),event('error','No source-tool call')]),status:'failed',error:'No source-tool call'});
 assert.equal(state(result,'gauge').state,'failed');assert.equal(state(result,'scout').state,'done');assert.equal(state(result,'warden').state,'waiting');
 assert.ok(result.activity.some(e=>e.text.includes('meta: Provider returned no tool call (failed)')));
});
test('stopping a run interrupts the current role and stops all working indicators',()=>{
 const result=deriveLiveActivity({...run({status:'stopped',investigation:{},trace:[{tool:'read_source',path:'src/robot.js'}]},[event('optimizer'),event('error','Stopped')]),status:'stopped'});
 assert.equal(state(result,'gauge').state,'stopped');assert.equal(result.activeId,null);assert.ok(!result.stages.some(s=>s.state==='working'));
});
test('repair invalidates previous risk-stage completion until its next assessment',()=>{
 const result=deriveLiveActivity(run({status:'building',investigation:{},riskAssessment:{provider:'Subquadratic',assessedAt:at},previewReady:true,guards:{pass:false}},[
  event('verifier'),{at:'2026-11-07T20:01:00Z',type:'repair',message:'Repair 1: inspecting failed candidate'}
 ]));
 assert.equal(result.activeId,'gauge');assert.equal(state(result,'smith').state,'waiting');assert.equal(state(result,'warden').state,'failed');
});
test('rejected correctness checks show Aegis failed, without claiming final benchmark verdict',()=>{
 const result=deriveLiveActivity({...run({status:'rejected',previewReady:true,investigation:{},guards:{pass:false},reason:'Picking changed'},[event('verify'),event('rejected')]),status:'completed'});
 assert.equal(state(result,'warden').state,'failed');assert.match(state(result,'warden').task,/Picking changed/);
});
test('baseline-only runs make no AI claims and do not pretend to optimize',()=>{
 const result=deriveLiveActivity({status:'completed',kind:'profile',baseline:{calls:1610},experiments:[],events:[event('profile'),event('complete')]});
 assert.equal(result.completedCount,1);assert.equal(state(result,'warden').state,'done');
 for(const id of ['scout','gauge','smith'])assert.equal(state(result,id).state,'skipped');
 assert.match(state(result,'warden').task,/No optimization/);
});
test('queued run has no active stage even if resuming persisted experiment evidence',()=>{
 const result=deriveLiveActivity({...run({status:'reasoning',investigation:{}},[event('optimizer')]),status:'queued'});
 assert.equal(result.activeId,null);assert.ok(!result.stages.some(s=>s.state==='working'));
});
test('UI preview is explicitly sample and cannot claim actual stage completion',()=>{
 const result=deriveLiveActivity(run({status:'accepted',investigation:{},previewReady:true,guards:{pass:true},verifier:{artifact:'verdict.json'}},[event('complete')]),{preview:true});
 assert.equal(result.completedCount,0);assert.equal(result.activeId,null);assert.ok(result.stages.every(s=>s.state==='sample'));
 assert.match(result.summary,/nothing is running/);assert.ok(result.activity.every(e=>e.text.startsWith('Sample ·')));
});
test('a baseline requested by Optimize shows waiting AI roles instead of not-run, without completing verification',()=>{
 const result=deriveLiveActivity({status:'running',kind:'profile',experiments:[],events:[event('profile','Profiling reference')]},{preparingOptimization:true});
 assert.equal(result.activeId,'warden');assert.equal(result.completedCount,0);
 for(const id of ['scout','gauge','smith']){assert.equal(state(result,id).state,'waiting');assert.match(state(result,id).task,/baseline/);}
 assert.match(result.summary,/AI stages follow/);
 const ended=deriveLiveActivity({status:'completed',kind:'profile',baseline:{calls:100},experiments:[],events:[event('complete')]},{preparingOptimization:true});
 assert.equal(ended.completedCount,0);assert.equal(ended.activeId,null);
});

test('repair tools take precedence over the previous verifying status left by the runner',()=>{
 const result=deriveLiveActivity(run({status:'verifying',investigation:{},previewReady:true,guards:{pass:false},trace:[{type:'agent-tool',role:'optimizer',tool:'read_source',path:'src/fleet.js'}]},[event('verify'),event('repair','Repair 1: inspecting the failed candidate')]));
 assert.equal(result.activeId,'gauge');assert.match(state(result,'gauge').task,/Reading source/);assert.equal(state(result,'warden').state,'failed');
});
