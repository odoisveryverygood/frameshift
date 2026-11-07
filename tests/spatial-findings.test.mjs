import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DATA } from '../server/core.mjs';
import { validateSceneContext, investigateSpatial, getFinding, listFindings, spatialRevision, recordFindingOutcome } from '../server/spatial.mjs';
import { investigateWithGemini } from '../server/gemini-investigator.mjs';
const context={selectedId:'robot-1',time:0,camera:null,selection:{id:'robot-1',anchor:{x:.2,y:.3,visible:true}},sourceAssociation:{confidence:'exact',path:'.env'}};
async function fixture(t) {
  const workspace=await fs.mkdtemp(path.join(os.tmpdir(),'earl-spatial-'));
  const project={id:'spatial-test-'+Date.now()+'-'+Math.random().toString(36).slice(2,5),config:{editableFiles:['scene.js']},discovery:{files:[{path:'scene.js'}]}};
  await fs.writeFile(path.join(workspace,'scene.js'),"export const prefix='robot-';\n");
  t.after(async()=>{await fs.rm(workspace,{recursive:true,force:true});await fs.rm(path.join(DATA,'projects',project.id),{recursive:true,force:true});});
  return {project,workspace};
}
test('scene context rejects invalid identities/camera/time and strips forged source trust',()=>{
  assert.equal(validateSceneContext(context).sourceAssociation,null);
  assert.throws(()=>validateSceneContext({...context,selectedId:'bad\nidentity'}),/Select/);
  assert.throws(()=>validateSceneContext({...context,time:Infinity}),/time/);
  assert.throws(()=>validateSceneContext({...context,camera:{position:[0,0,0]}}),/camera/);
});
test('findings bind captured selection, source revision and explicit provider; changed source makes them stale',async t=>{
  const {project,workspace}=await fixture(t);
  const options={workspace,captureScene:async()=>({screenshot:Buffer.from('fixture screenshot'),metrics:{calls:12,scope:'whole-frame'},state:{semanticObjects:1600}}),metaInvestigator:async()=>({provider:'meta',model:'fixture',hypothesis:'Group robots',objective:'Measure submissions',evidence:[{path:'scene.js',observation:'robot prefix'}],relevantFiles:['scene.js']})};
  const finding=await investigateSpatial(project,{goal:'inspect fleet',context,provider:'meta'},undefined,options);
  assert.equal(finding.provider,'meta');assert.equal(finding.sourceConfidence,'inferred');assert.equal(finding.sourceAssociations[0].confidence,'inferred');
  assert.equal((await getFinding(project,finding.id,{workspace})).revision,await spatialRevision(project,{workspace}));
  await recordFindingOutcome(project,finding.id,{runId:'test-run',experimentId:'test-exp',status:'rejected',reason:'Selection mismatch'});
  assert.equal((await getFinding(project,finding.id,{workspace})).outcome.reason,'Selection mismatch');
  await fs.writeFile(path.join(workspace,'scene.js'),'export const revised=1;');
  assert.equal((await listFindings(project,{workspace})).findings[0].stale,true);
  await assert.rejects(()=>getFinding(project,finding.id,{workspace}),/older source revision/);
});
test('Argon uses real read-only tool protocol, actual screenshot and inspected source hashes',async t=>{
  const {project,workspace}=await fixture(t);let n=0;
  const finish={hypothesis:'Group repeated robots',objective:'Reduce measured frame calls',explanation:'Repeated submissions',uncertainty:'Source association inferred',proposedCheck:'Check identity after motion',relevantFiles:['scene.js'],evidence:[{path:'scene.js',observation:'Robot prefix'}]};
  const fetchImpl=async(url,req)=>{
    assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-argon:generateContent');
    const body=JSON.parse(req.body);assert.ok(!body.tools[0].functionDeclarations.some(d=>d.name==='submit_patch'));
    if(n===0){assert.equal(body.contents[0].parts[1].inlineData.mimeType,'image/png');}
    else assert.equal(body.contents[1].parts[0].thoughtSignature,'opaque-test-signature');
    const call=n++===0?{name:'read_source',args:{path:'scene.js',startLine:1,endLine:20}}:{name:'submit_finding',args:finish};
    return new Response(JSON.stringify({candidates:[{content:{role:'model',parts:[{functionCall:{id:'call-'+n,...call},thoughtSignature:'opaque-test-signature'}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:10}}));
  };
  const result=await investigateWithGemini({workspace,manifest:project.discovery,config:project.config,goal:'inspect',context,screenshot:Buffer.from('fixture-image')},{apiKey:'fixture-key',fetchImpl,skipBudget:true});
  assert.equal(result.provider,'gemini');assert.match(result.evidence[0].sha256,/^[a-f0-9]{64}$/);assert.equal(result.trace.length,2);assert.ok(!JSON.stringify(result).includes('opaque-test-signature'));
});
test('Argon refuses unknown tools, unread evidence and denied provider access without fallback',async t=>{
  const {project,workspace}=await fixture(t);const args={workspace,manifest:project.discovery,config:project.config,goal:'inspect',context};
  await assert.rejects(()=>investigateWithGemini(args,{apiKey:'fixture',skipBudget:true,fetchImpl:async()=>new Response('{}',{status:403})}),/403.*No fallback/);
  let n=0;
  await assert.rejects(()=>investigateWithGemini(args,{apiKey:'fixture',skipBudget:true,fetchImpl:async()=>{n++;return new Response(JSON.stringify({candidates:[{content:{role:'model',parts:[{functionCall:{id:'c',name:'submit_patch',args:{}}}]}}]}));}}),/bounded inspection limit/);
  assert.equal(n,7);
});
