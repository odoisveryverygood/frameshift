import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {writeStlViewer} from '../server/stl/viewer-template.mjs';
const triangle=new Float32Array([0,0,0,2,0,0,0,3,0]);
test('STL viewer writes exact binary geometry, explicit units and safe source-inspectable templates',async t=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'earl-stl-viewer-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));
 const result=await writeStlViewer(folder,{positions:triangle,componentIds:new Uint32Array([0]),units:'mm',name:'<script>bad()</script>',sourceHash:'a'.repeat(64),originalPositions:new Float32Array([...triangle,...triangle])});
 assert.deepEqual(result.metadata.bounds.dimensions,[2,3,0]);assert.equal(result.metadata.triangles,1);assert.equal(result.metadata.sourcePreview.triangles,2);
 const bytes=await fs.readFile(path.join(folder,'public/mesh.bin'));assert.equal(bytes.length,36);assert.equal(bytes.readFloatLE(12),2);
 const index=await fs.readFile(path.join(folder,'index.html'),'utf8');assert.ok(!index.includes('bad()'));
 const main=await fs.readFile(path.join(folder,'src/main.js'),'utf8');assert.ok(main.includes('meshFingerprint'));assert.ok(main.includes("get('variant')==='source'"));
 assert.deepEqual(result.config.editableFiles,['src/scene.js']);assert.equal(result.config.autoInstrument,false);assert.equal(result.config.requireMeshFingerprint,true);
});
test('STL viewer rejects malformed geometry and keeps inferred-shell grouping explicit',async t=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'earl-stl-viewer-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));
 await assert.rejects(()=>writeStlViewer(folder,{positions:new Float32Array([NaN,0,0,1,0,0,0,1,0])}),/non-finite/);
 await assert.rejects(()=>writeStlViewer(folder,{positions:triangle,units:'guess'}),/explicit STL units/);
 await assert.rejects(()=>writeStlViewer(folder,{positions:triangle,componentIds:[-1]}),/shell identity/);
 const many=new Float32Array(513*9);const ids=new Uint32Array(513);for(let i=0;i<513;i++){many.set(triangle,i*9);ids[i]=i;}
 const r=await writeStlViewer(folder,{positions:many,componentIds:ids});assert.equal(r.metadata.componentsGroupedForDisplay,true);assert.equal(r.metadata.renderGroups,1);assert.equal(r.metadata.inferredShellCount,513);
});


test('large mesh overview labels sampled geometry and never infers robot parts or complete bounds',async t=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'earl-stl-overview-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));
 const positions=new Float32Array([...triangle,...triangle.map((n,i)=>i%3===0?n+5:n)]);
 const r=await writeStlViewer(folder,{positions,componentIds:new Uint32Array([0,1]),units:'mm',name:'FTC robot',report:{previewOnly:true,largeMesh:true,outputTriangles:12808642}});
 assert.equal(r.metadata.previewOnly,true);assert.equal(r.metadata.largeMesh,true);assert.equal(r.metadata.triangles,2);assert.equal(r.metadata.fullMeshTriangles,12808642);
 assert.equal(r.metadata.renderGroups,1);assert.equal(r.metadata.inferredShellCount,null);assert.match(r.metadata.name,/mesh overview/);
 assert.equal(r.metadata.identityScope,'Display overview only; sampled triangles are not identified robot parts or complete geometry.');
 assert.equal(r.config.previewOnly,true);assert.equal(r.config.requireMeshFingerprint,true);
 const bytes=await fs.readFile(path.join(folder,'public/components.bin'));assert.equal(bytes.readUInt32LE(0),0);assert.equal(bytes.readUInt32LE(4),0);
 const main=await fs.readFile(path.join(folder,'src/main.js'),'utf8');assert.ok(main.includes(' triangles · overview only'));assert.ok(main.includes("Sampled overview geometry only"));
 await assert.rejects(()=>writeStlViewer(folder,{positions,report:{previewOnly:true,outputTriangles:1}}),/full repaired mesh triangle count/);
});
