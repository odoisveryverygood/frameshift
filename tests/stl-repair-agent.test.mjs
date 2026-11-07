import test from 'node:test';import assert from 'node:assert/strict';
import {runRepairAgent} from '../server/stl/repair-agent.mjs';
const call=(name,args={})=>({functionCall:{name,args}});
const response=parts=>({ok:true,json:async()=>({candidates:[{content:{role:'model',parts}}]})});
const record={filename:'authored fixture.stl',units:'mm',report:{inputTriangles:24,outputTriangles:24},repairedSha256:'fixture-hash'};
test('Repair agent reads evidence and executes a host-bound alignment tool; it cannot export',async()=>{
 const requests=[];let measured=0,solved=0;
 const result=await runRepairAgent('fixture',{goal:'align fixture',bounds:{min:[0,0,0],max:[2,2,2]},sourcePoints:[[0,0,0],[1,0,0],[0,1,0]],targetPoints:[[3,0,0],[4,0,0],[3,1,0]]},{apiKey:'test-not-a-real-key',skipBudget:true,skipPersist:true,getImport:async()=>record,measure:async()=>{measured++;return{selectedTriangles:12}},plan:async(id,input)=>{solved++;assert.equal(input.sourcePoints[0][0],0);return{id:'host-plan',matrix:Array(16).fill(0)}},fetchImpl:async(url,options)=>{
  const request=JSON.parse(options.body);requests.push(request);assert.ok(request.tools[0].functionDeclarations.every(d=>!d.name.includes('export')));
  return requests.length===1?response([call('read_mesh_report'),call('measure_selected_region'),call('calculate_alignment',{sourcePoints:[[999,999,999]]})]):response([call('finish_repair_advice',{message:'Review the calculated alignment before exporting.'})]);
 }});
 assert.equal(result.status,'plan_ready');assert.equal(result.plan.id,'host-plan');assert.equal(measured,1);assert.equal(solved,1);assert.equal(result.mode,'live');assert.equal(requests.length,2);assert.ok(result.trace.every(t=>t.ok));
});
test('Repair agent rejects fabricated tool authority and finishing before reading; missing landmarks require input',async()=>{
 let round=0;const result=await runRepairAgent('fixture',{goal:'fix it'},{apiKey:'test-not-a-real-key',skipBudget:true,skipPersist:true,getImport:async()=>record,fetchImpl:async()=>{
  round++;return round===1?response([call('export_candidate'),call('finish_repair_advice',{message:'Fixed.'})]):response([call('read_mesh_report'),call('calculate_alignment'),call('finish_repair_advice',{message:'Provide mounting points and select a region.'})]);
 }});
 assert.equal(result.status,'needs_input');assert.equal(result.plan,null);assert.equal(result.trace[0].ok,false);assert.equal(result.trace[1].ok,false);assert.match(result.trace.find(x=>x.tool==='calculate_alignment').error,/mounting/);
});
