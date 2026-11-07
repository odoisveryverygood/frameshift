import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { investigateProject } from '../server/investigator.mjs';
import { proposeExperiment } from '../server/agent.mjs';
import { provider, providerApiKey } from '../server/model.mjs';

async function fixture(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'earl-specialists-'));
  await fs.writeFile(path.join(root,'scene.js'),'export const count = 1600;\n');
  const oldEnv = {...process.env}, oldFetch = globalThis.fetch;
  process.env.EARL_SPONSOR_MODE='1'; process.env.MODEL_API_KEY='meta-test-only';
  const opts={workspace:root,manifest:{files:[{path:'scene.js'}]},config:{editableFiles:['scene.js']},metrics:{drawCalls:1600}};
  try { await fn(opts); } finally {
    globalThis.fetch=oldFetch;
    for(const k of ['EARL_SPONSOR_MODE','MODEL_API_KEY']) {
      if(oldEnv[k]===undefined) delete process.env[k]; else process.env[k]=oldEnv[k];
    }
    await fs.rm(root,{recursive:true,force:true});
  }
}
function call(name,args) { return new Response(JSON.stringify({id:'test',output:[{type:'function_call',call_id:'c',name,arguments:JSON.stringify(args)}],usage:{total_tokens:1}}),{status:200}); }
const brief={hypothesis:'Repeated submissions',objective:'Reduce measured calls preserving objects',relevantFiles:['scene.js'],evidence:[{path:'scene.js',observation:'1600 count source constant'}]};

test('Meta Investigator has only read tools and attaches inspected hashes; Optimizer gets a new context',async()=>fixture(async opts=>{
  let n=0;
  globalThis.fetch=async(url,request)=>{
    const payload=JSON.parse(request.body);
    assert.equal(url,'https://api.meta.ai/v1/responses');
    assert.equal(request.headers.Authorization,'Bearer meta-test-only');
    assert.equal(payload.tool_choice,'auto');
    assert.ok(payload.include.includes('reasoning.encrypted_content'));
    const names=payload.tools.map(t=>t.name);
    assert.ok(!names.includes('submit_patch'));
    if(n++===0) return call('read_source',{path:'scene.js',startLine:1,endLine:20});
    return call('submit_investigation',brief);
  };
  const result=await investigateProject(opts);
  assert.equal(result.provider,'meta');assert.equal(result.role,'investigator');
  assert.match(result.evidence[0].sha256,/^[a-f0-9]{64}$/);
  assert.equal(await fs.readFile(path.join(opts.workspace,'scene.js'),'utf8'),'export const count = 1600;\n');
  globalThis.fetch=async(url,request)=>{
    const payload=JSON.parse(request.body);
    assert.equal(payload.input.length,1);
    assert.ok(JSON.parse(payload.input[0].content).investigation.evidence[0].sha256);
    assert.ok(!payload.tools.some(t=>t.name==='submit_investigation'));
    return call('submit_patch',{title:'No safe change',hypothesis:'No demonstrated patch',expectedEffect:'None',edits:[],notes:'No change'});
  };
  const proposal=await proposeExperiment({...opts,investigation:result});
  assert.equal(proposal.role,'optimizer');assert.equal(proposal.files.length,0);
}));

test('Investigator cannot finish with unread evidence or invoke patch submission',async()=>fixture(async opts=>{
  let n=0;
  globalThis.fetch=async()=> n++===0 ? call('submit_patch',{edits:[]}) : call('submit_investigation',brief);
  await assert.rejects(()=>investigateProject({...opts,config:{...opts.config,agentMaxRounds:2}}),/inspection limit/);
  assert.equal(await fs.readFile(path.join(opts.workspace,'scene.js'),'utf8'),'export const count = 1600;\n');
}));

test('Sponsor mode reports missing Meta key and does not use existing OpenAI access',async()=>fixture(async opts=>{
  delete process.env.MODEL_API_KEY;
  assert.equal(provider().name,'meta');assert.equal(provider().configured,false);assert.equal(providerApiKey(),undefined);
  await assert.rejects(()=>investigateProject(opts),/API key/);
}));

test('Investigator rejects evidence if the source changes after inspection',async()=>fixture(async opts=>{
  let n=0;
  globalThis.fetch=async()=>{
    if(n++===0) return call('read_source',{path:'scene.js',startLine:1,endLine:20});
    await fs.writeFile(path.join(opts.workspace,'scene.js'),'export const count = 12;\n');
    return call('submit_investigation',brief);
  };
  await assert.rejects(()=>investigateProject({...opts,config:{...opts.config,agentMaxRounds:2}}),/inspection limit/);
}));

test('Meta continues bounded reasoning-only output and reports safe diagnostics without accepting prose',async()=>fixture(async opts=>{
  let n=0;const events=[];
  globalThis.fetch=async(url,request)=>{
    const payload=JSON.parse(request.body);
    assert.equal(payload.reasoning.effort,'low');
    if(n++===0) return new Response(JSON.stringify({status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[{type:'reasoning',encrypted_content:'opaque-test'}],usage:{output_tokens:1000,output_tokens_details:{reasoning_tokens:1000}}}),{status:200});
    assert.equal(payload.max_output_tokens,2000);
    assert.ok(payload.input.some(x=>x.type==='reasoning' && x.encrypted_content==='opaque-test'));
    assert.ok(payload.input.at(-1).content.includes('call submit_patch'));
    return call('submit_patch',{title:'No safe change',hypothesis:'No demonstrated patch',expectedEffect:'None',edits:[],notes:'No change'});
  };
  const result=await proposeExperiment({...opts,config:{...opts.config,agentOutputTokens:1000},onEvent:e=>events.push(e)});
  assert.equal(result.files.length,0);assert.equal(n,2);
  const diagnostic=events.find(e=>e.type==='agent-provider-response');
  assert.equal(diagnostic.incompleteReason,'max_output_tokens');assert.equal(diagnostic.reasoningTokens,1000);
  assert.ok(!JSON.stringify(diagnostic).includes('opaque-test'));
}));

test('Meta prose-only answers fail after two continuations without fabricating a proposal',async()=>fixture(async opts=>{
  let requests=0;
  globalThis.fetch=async()=>{requests++;return new Response(JSON.stringify({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'I optimized it.'}]}],usage:{output_tokens:5}}),{status:200});};
  await assert.rejects(()=>proposeExperiment(opts),/no source-tool call/);
  assert.equal(requests,3);
}));
