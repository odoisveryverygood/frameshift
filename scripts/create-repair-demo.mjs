/** Reproducible authored two-part UI demo. Uses actual local endpoints, no model calls. */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {ROOT} from '../server/core.mjs';
import path from 'node:path';
const base='http://127.0.0.1:'+String(Number(process.env.PORT)||4310);
async function post(route,body,raw=false){
 const response=await fetch(base+route,{method:'POST',headers:{'Content-Type':raw?'application/octet-stream':'application/json'},body:raw?body:JSON.stringify(body),signal:AbortSignal.timeout(180000)});
 const value=await response.json();if(!response.ok)throw Error(value.error||'Demo request failed.');return value;
}
try{
 const fixture=JSON.parse(await fs.readFile(path.join(ROOT,'tests/fixtures/stl/two-part-alignment.json'),'utf8'));
 const bytes=await fs.readFile(path.join(ROOT,'tests/fixtures/stl/two-part-alignment.stl'));
 const {import:record}=await post('/api/stl/import?filename='+encodeURIComponent(fixture.filename)+'&units=mm',bytes,true);
 const {plan}=await post(`/api/stl/imports/${record.id}/repair-plan`,fixture);
 const {candidate}=await post(`/api/stl/imports/${record.id}/repair-candidates`,{planId:plan.id,confirmPlacement:true});
 assert.equal(candidate.verified,true);assert.equal(candidate.verification.outputTriangles,24);
 assert.equal(candidate.verification.unselectedInputSha256,candidate.verification.unselectedOutputSha256);
 const preview=await fetch(base+candidate.previewPositionsUrl);assert.equal(preview.status,200);
 console.log('Authored two-part alignment demo: real export and independent geometry checks passed.');
 console.log('This is a controlled fixture, not evidence of a robot mounting arrangement.');
 console.log(base+`/repair?import=${record.id}&candidate=${candidate.id}`);
}catch(error){console.error('Start Earl/Sift with npm start, finish active jobs, then retry. '+error.message);process.exitCode=1;}
