import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { solveRigidAlignment, transformBinaryRegion, verifyBinaryRegion } from '../server/stl/repair-geometry.mjs';
const ID=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const MATRIX=[0,1,0,0,-1,0,0,0,0,0,1,0,3,4,5,1];
const BOX={min:[-.01,-.01,-.01],max:[1.01,1.01,1.01]};
const SOURCE=[[0,0,0],[1,0,0],[0,1,0],[0,0,1]];
const TARGET=SOURCE.map(([x,y,z])=>[-y+3,x+4,z+5]);
const SHA=b=>crypto.createHash('sha256').update(b).digest('hex');
function fixture(){
 const [a,b,c,d]=SOURCE,faces=[[a,c,b],[a,b,d],[a,d,c],[b,c,d],[[10,0,0],[11,0,0],[10,1,0]]];
 const data=Buffer.alloc(84+faces.length*50);data.write('STLB ATF 15.17.0.0 COLOR=');data.set([42,53,64,255],27);data.writeUInt32LE(faces.length,80);
 faces.forEach((vertices,i)=>{const o=84+i*50;const ab=vertices[1].map((v,k)=>v-vertices[0][k]),ac=vertices[2].map((v,k)=>v-vertices[0][k]);const normal=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];normal.forEach((n,k)=>data.writeFloatLE(n,o+k*4));vertices.flat().forEach((n,k)=>data.writeFloatLE(n,o+12+k*4));data.writeUInt16LE(100+i,o+48);});return data;
}
async function files(t,data=fixture()){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'earl-region-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const input=path.join(dir,'source.stl'),output=path.join(dir,'candidate.stl');await fs.writeFile(input,data);return{dir,input,output,data};
}
function near(a,b,tol=1e-8){assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);}
test('rigid solver returns proper column-major rotation and translation; planar landmarks also work',()=>{
 for(const count of [3,4]){const solved=solveRigidAlignment(SOURCE.slice(0,count),TARGET.slice(0,count),{maxResidual:1e-6});solved.matrix.forEach((v,i)=>near(v,MATRIX[i]));near(solved.determinant,1);near(solved.maxError,0);near(solved.rmsError,0);assert.equal(solved.scale,1);assert.equal(solved.poseCorrectness,'not-assessed');}
});
test('solver rejects invalid/degenerate landmarks, reflections, scaled targets and poor fits',()=>{
 for(const args of [
  [SOURCE.slice(0,2),TARGET.slice(0,2)], [SOURCE,TARGET.slice(0,3)],
  [[[0,0,0],[1,1,1],[2,2,2]],[[1,0,0],[2,1,1],[3,2,2]]],
  [[[0,0,0],[0,0,0],[1,1,0]],TARGET.slice(0,3)],
  [[[NaN,0,0],[1,0,0],[0,1,0]],TARGET.slice(0,3)],
  [Array.from({length:33},(_,i)=>[i,i*i,i%2]),Array.from({length:33},(_,i)=>[i,i*i,i%2])],
  [SOURCE,SOURCE.map(([x,y,z])=>[-x,y,z])],
  [SOURCE,SOURCE.map(p=>p.map(v=>v*2)),{maxResidual:1e-6}],
  [SOURCE,TARGET.map((p,i)=>i===3?[p[0]+10,p[1],p[2]]:p),{maxResidual:.01}],
  [SOURCE,TARGET,{maxResidual:-1}],
 ])assert.throws(()=>solveRigidAlignment(...args));
});
test('stream transform preserves original/header/attributes/outside facets and verifies independently',async t=>{
 const f=await files(t);const report=await transformBinaryRegion(f.input,{outputPath:f.output,bounds:BOX,matrix:MATRIX});const candidate=await fs.readFile(f.output);
 assert.deepEqual(await fs.readFile(f.input),f.data);assert.deepEqual(candidate.subarray(0,84),f.data.subarray(0,84));assert.deepEqual(candidate.subarray(84+4*50),f.data.subarray(84+4*50));
 assert.equal(report.selectedTriangles,4);assert.equal(report.unselectedTriangles,1);assert.equal(report.boundaryCrossingFacets,0);assert.equal(report.verification.pass,false);assert.equal(report.inputSha256,SHA(f.data));assert.equal(report.outputSha256,SHA(candidate));
 assert.equal(report.selectedInputSha256,SHA(f.data.subarray(84,284)));assert.equal(report.unselectedInputSha256,report.unselectedOutputSha256);assert.deepEqual(report.bounds.selectedAfter,{min:[2,4,5],max:[3,5,6],size:[1,1,1]});
 for(let i=0;i<4;i++){const o=84+i*50;assert.equal(candidate.readUInt16LE(o+48),f.data.readUInt16LE(o+48));for(let v=0;v<3;v++){const p=o+12+v*12,x=f.data.readFloatLE(p),y=f.data.readFloatLE(p+4),z=f.data.readFloatLE(p+8);assert.deepEqual([candidate.readFloatLE(p),candidate.readFloatLE(p+4),candidate.readFloatLE(p+8)],[-y+3,x+4,z+5]);}near(candidate.readFloatLE(o),-f.data.readFloatLE(o+4));near(candidate.readFloatLE(o+4),f.data.readFloatLE(o));near(candidate.readFloatLE(o+8),f.data.readFloatLE(o+8));}
 const verified=await verifyBinaryRegion(f.input,f.output,{bounds:BOX,matrix:MATRIX,expected:report});assert.equal(verified.pass,true);assert.equal(verified.verification.pass,true);assert.ok(Object.values(verified.checks).every(Boolean));assert.equal(verified.outputSha256,report.outputSha256);assert.equal(verified.maxPositionError,0);assert.equal(verified.collisionAssessment,'not-assessed');assert.match(verified.limitations.join(' '),/not.*repairs the robot/);
});
test('partial boundary, empty and whole-model selections block publication and independently fail verification',async t=>{
 const f=await files(t);await fs.writeFile(f.output,f.data);
 const boxes=[{min:[-1,-1,-1],max:[0,2,2]}, {min:[30,30,30],max:[31,31,31]}, {min:[-1,-1,-1],max:[20,20,20]}];
 for(let i=0;i<boxes.length;i++){const target=path.join(f.dir,`reject-${i}.stl`);await assert.rejects(transformBinaryRegion(f.input,{outputPath:target,bounds:boxes[i],matrix:ID}),i===0?/cross the region boundary/:i===1?/no whole facets/:/entire model/);await assert.rejects(fs.stat(target),{code:'ENOENT'});await assert.rejects(verifyBinaryRegion(f.input,f.output,{bounds:boxes[i],matrix:ID}));}
 assert.deepEqual((await fs.readdir(f.dir)).sort(),['candidate.stl','source.stl']);
});
test('verifier detects selected position/normal/attribute edits, outside edits, header edits and mismatched metadata',async t=>{
 const f=await files(t);const report=await transformBinaryRegion(f.input,{outputPath:f.output,bounds:BOX,matrix:MATRIX});const candidate=await fs.readFile(f.output);
 const mutations=[b=>b.writeFloatLE(b.readFloatLE(96)+.01,96),b=>b.writeFloatLE(.02,84),b=>b.writeUInt16LE(12,132),b=>b.writeUInt16LE(12,84+4*50+48),b=>b.writeUInt8(0,2),b=>b.writeFloatLE(Infinity,100)];
 for(const mutate of mutations){const damaged=Buffer.from(candidate);mutate(damaged);await fs.writeFile(f.output,damaged);await assert.rejects(verifyBinaryRegion(f.input,f.output,{bounds:BOX,matrix:MATRIX}));}
 await fs.writeFile(f.output,candidate);for(const expected of [{selectedTriangles:3},{inputSha256:'bad'},{outputSha256:'bad'}])await assert.rejects(verifyBinaryRegion(f.input,f.output,{bounds:BOX,matrix:MATRIX,expected}),/does not match expected/);
 assert.equal((await verifyBinaryRegion(f.input,f.output,{bounds:BOX,matrix:MATRIX,expected:report})).pass,true);
});
test('invalid matrices/bounds, malformed and nonfinite STL, overwrite and cancellation are rejected safely',async t=>{
 const f=await files(t);const matrices=[ID.map((v,i)=>i===0?2:v),ID.map((v,i)=>i===0?-1:v),ID.map((v,i)=>i===4?.2:v),ID.map((v,i)=>i===3?.1:v),ID.map((v,i)=>i===12?NaN:v),ID.slice(0,15)];
 for(const matrix of matrices)await assert.rejects(transformBinaryRegion(f.input,{outputPath:f.output,bounds:BOX,matrix}));
 await assert.rejects(transformBinaryRegion(f.input,{outputPath:f.output,bounds:{min:[2,0,0],max:[1,1,1]},matrix:ID}),/bounds/);
 await assert.rejects(transformBinaryRegion(f.input,{outputPath:f.input,bounds:BOX,matrix:ID}),/original/);
 await fs.writeFile(f.output,'existing');await assert.rejects(transformBinaryRegion(f.input,{outputPath:f.output,bounds:BOX,matrix:ID}),/already exists/);assert.equal(await fs.readFile(f.output,'utf8'),'existing');await fs.unlink(f.output);
 for(const data of [f.data.subarray(0,-1),Buffer.alloc(70),Buffer.from(f.data)]){if(data.length===f.data.length)data.writeFloatLE(NaN,84);await fs.writeFile(f.input,data);await assert.rejects(transformBinaryRegion(f.input,{outputPath:f.output,bounds:BOX,matrix:ID}));await assert.rejects(fs.stat(f.output),{code:'ENOENT'});}
 await fs.writeFile(f.input,f.data);const controller=new AbortController();controller.abort();await assert.rejects(transformBinaryRegion(f.input,{outputPath:f.output,bounds:BOX,matrix:ID,signal:controller.signal}),{name:'AbortError'});assert.deepEqual(await fs.readdir(f.dir),['source.stl']);
});
test('chunk boundaries preserve hashes and independently verify all facets',async t=>{
 const seed=fixture(),n=20_004,data=Buffer.alloc(84+n*50);seed.copy(data,0,0,84);data.writeUInt32LE(n,80);for(let i=0;i<n;i++)seed.copy(data,84+i*50,84+(i%5)*50,84+(i%5+1)*50);
 const f=await files(t,data);const report=await transformBinaryRegion(f.input,{outputPath:f.output,bounds:BOX,matrix:MATRIX});assert.equal(report.selectedTriangles,16_004);assert.equal(report.unselectedTriangles,4000);const verified=await verifyBinaryRegion(f.input,f.output,{bounds:BOX,matrix:MATRIX,expected:report});assert.equal(verified.pass,true);assert.equal(verified.inputSha256,SHA(data));
});
