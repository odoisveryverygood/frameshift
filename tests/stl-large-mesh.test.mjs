import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { analyzeLargeBinaryStl, LARGE_STL_LIMITS } from '../server/stl/large-mesh.mjs';
const triangle=[0,0,0,1,0,0,0,1,0];
function binary(faces) {
 const data=Buffer.alloc(84+faces.length*50);data.write('STLB ATF 15.17.0.0 COLOR=');data[25]=255;data[26]=80;data[27]=30;data[28]=255;data.writeUInt32LE(faces.length,80);
 faces.forEach((face,index)=>{const at=84+index*50;data.writeFloatLE(NaN,at);data.writeFloatLE(0,at+4);data.writeFloatLE(0,at+8);face.forEach((value,i)=>data.writeFloatLE(value,at+12+i*4));data.writeUInt16LE(0x8000+index,at+48);});return data;
}
async function fixture(t,data) {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'earl-large-stl-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const inputPath=path.join(dir,'original.stl'),outputPath=path.join(dir,'repaired.stl');await fs.writeFile(inputPath,data);return {dir,inputPath,outputPath};
}
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

test('streaming normalization retains every usable facet, header/color/attribute bytes and raw original',async t=>{
 const nonFinite=[...triangle];nonFinite[0]=NaN;const degenerate=Array(9).fill(0),second=triangle.map((value,i)=>i%3===0?value+2:value);
 const data=binary([triangle,nonFinite,degenerate,second,triangle]);const f=await fixture(t,data);
 const result=await analyzeLargeBinaryStl(f.inputPath,{outputPath:f.outputPath,units:'mm'}),out=await fs.readFile(f.outputPath);
 assert.deepEqual(await fs.readFile(f.inputPath),data);assert.deepEqual(out.subarray(0,80),data.subarray(0,80));
 assert.equal(result.report.headerPreserved,true);assert.equal(result.report.inputTriangles,5);assert.equal(result.report.outputTriangles,3);assert.equal(out.readUInt32LE(80),3);
 assert.deepEqual(result.report.removed,{nonFinite:1,degenerate:1});assert.equal(result.report.removedDuplicate,null);
 for(const [outputIndex,inputIndex] of [[0,0],[1,3],[2,4]]) {
  assert.deepEqual(out.subarray(96+outputIndex*50,134+outputIndex*50),data.subarray(96+inputIndex*50,134+inputIndex*50));
  assert.equal(out.readFloatLE(84+outputIndex*50),0);assert.equal(out.readFloatLE(88+outputIndex*50),0);assert.equal(out.readFloatLE(92+outputIndex*50),1);
 }
 assert.equal(result.report.correctedNormals,3);assert.equal(result.report.recalculatedNormals,3);assert.equal(result.report.invalidNormals,5);
 assert.equal(result.report.inputSha256,sha(data));assert.equal(result.report.repairedSha256,sha(out));
 assert.deepEqual(result.report.bounds,{min:[0,0,0],max:[3,1,0],size:[3,1,0]});
 assert.equal(result.report.requiresReview,true);assert.equal(result.report.retainedEveryUsableTriangle,true);
 assert.equal(result.report.topology.assessed,false);assert.equal(result.report.connectedComponents,null);
 assert.ok(!((await fs.readdir(f.dir)).some(name=>name.endsWith('.tmp'))));
});

test('display sample spans complete input while repaired download retains full triangle count',async t=>{
 const faces=Array.from({length:21},(_,index)=>triangle.map((value,i)=>i%3===0?value+index*2:value));
 const f=await fixture(t,binary(faces)),r=await analyzeLargeBinaryStl(f.inputPath,{outputPath:f.outputPath,units:'in',previewTriangles:5});
 assert.equal(r.report.largeMesh,true);assert.equal(r.report.previewOnly,true);assert.equal(r.report.previewTriangles,5);assert.equal(r.report.displayOnly,true);
 assert.equal(r.report.preview.sampled,true);assert.equal(r.report.preview.firstSourceFacet,0);assert.equal(r.report.preview.lastSourceFacet,20);
 assert.equal(r.report.fullOutputTriangles,21);assert.equal(r.report.fullGeometryRetained,true);assert.equal(r.positions.length,45);
 assert.deepEqual([0,1,2,3,4].map(index=>r.positions[index*9]),[0,10,20,30,40]);assert.deepEqual([...r.componentIds],[0,0,0,0,0]);
 assert.equal((await fs.stat(f.outputPath)).size,84+21*50);assert.equal(r.report.scaleToMeters,.0254);
 assert.ok(r.report.issues.some(issue=>issue.includes('does not render the full')));assert.equal(r.report.boundaryEdges,null);assert.equal(r.report.nonManifoldEdges,null);
});

test('malformed binary lengths/counts, invalid units and preview budgets never publish an output',async t=>{
 const data=binary([triangle]);const f=await fixture(t,data.subarray(0,data.length-1));
 await assert.rejects(()=>analyzeLargeBinaryStl(f.inputPath,{outputPath:f.outputPath,units:'mm'}),/truncated/);
 await fs.writeFile(f.inputPath,Buffer.concat([data,Buffer.from([0])]));await assert.rejects(()=>analyzeLargeBinaryStl(f.inputPath,{outputPath:f.outputPath,units:'mm'}),/length does not match/);
 await fs.writeFile(f.inputPath,Buffer.alloc(83));await assert.rejects(()=>analyzeLargeBinaryStl(f.inputPath,{outputPath:f.outputPath,units:'mm'}),/too short/);
 const count=Buffer.alloc(84);count.writeUInt32LE(LARGE_STL_LIMITS.maxTriangles+1,80);await fs.writeFile(f.inputPath,count);await assert.rejects(()=>analyzeLargeBinaryStl(f.inputPath,{outputPath:f.outputPath,units:'mm'}),/15,000,000/);
 await assert.rejects(()=>analyzeLargeBinaryStl(f.inputPath,{outputPath:f.outputPath,units:'guess'}),/Choose/);
 await assert.rejects(()=>analyzeLargeBinaryStl(f.inputPath,{outputPath:f.outputPath,units:'mm',previewTriangles:150001}),/Display sample/);
 assert.deepEqual(await fs.readdir(f.dir),['original.stl']);
});

test('zero usable geometry and cancellation clean partial output files',async t=>{
 const f=await fixture(t,binary([Array(9).fill(0)]));
 await assert.rejects(()=>analyzeLargeBinaryStl(f.inputPath,{outputPath:f.outputPath,units:'mm'}),/No usable/);assert.deepEqual(await fs.readdir(f.dir),['original.stl']);
 const data=binary([triangle]);await fs.writeFile(f.inputPath,data);
 let checks=0;const signal={throwIfAborted(){if(++checks===5)throw Error('cancelled during output');}};
 await assert.rejects(()=>analyzeLargeBinaryStl(f.inputPath,{outputPath:f.outputPath,units:'mm',signal}),/cancelled during output/);
 assert.deepEqual(await fs.readFile(f.inputPath),data);assert.deepEqual(await fs.readdir(f.dir),['original.stl']);
 const controller=new AbortController();controller.abort();await assert.rejects(()=>analyzeLargeBinaryStl(f.inputPath,{outputPath:f.outputPath,units:'mm',signal:controller.signal}),/abort/i);
});

test('original and pre-existing output paths cannot be overwritten',async t=>{
 const data=binary([triangle]),f=await fixture(t,data);await fs.writeFile(f.outputPath,'existing output');
 await assert.rejects(()=>analyzeLargeBinaryStl(f.inputPath,{outputPath:f.outputPath,units:'mm'}),/already exists/);
 assert.equal(await fs.readFile(f.outputPath,'utf8'),'existing output');assert.deepEqual(await fs.readFile(f.inputPath),data);
 await assert.rejects(()=>analyzeLargeBinaryStl(f.inputPath,{outputPath:f.inputPath,units:'mm'}),/different path/);
});
