import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {generateRepairOverview} from '../server/stl/repair-preview.mjs';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function binary(facets){const data=Buffer.alloc(84+facets.length*50);data.write('fixture');data.writeUInt32LE(facets.length,80);for(let i=0;i<facets.length;i++)for(let j=0;j<9;j++)data.writeFloatLE(facets[i][j],84+i*50+12+j*4);return data;}
async function fixture(t,facets){const base=await fs.mkdtemp(path.join(os.tmpdir(),'earl-repair-overview-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const input=path.join(base,'robot.stl'),directory=path.join(base,'derived'),bytes=binary(facets);await fs.writeFile(input,bytes);return {base,input,directory,bytes};}
const tri=[0,0,0,1,0,0,0,1,0];
test('overview scans every facet, preserves originals, labels approximations and maps representative source facets',async t=>{
 const f=await fixture(t,[tri,tri,[NaN,0,0,1,0,0,0,1,0],[0,0,0,0,0,0,0,0,0]]);
 const r=await generateRepairOverview(f.input,{directory:f.directory,maxTriangles:10});
 assert.equal(r.metadata.sourceTriangles,4);assert.equal(r.metadata.validSourceTriangles,2);assert.deepEqual(r.metadata.skippedSourceFacets,{nonFinite:1,degenerate:1});
 assert.equal(r.metadata.previewTriangles,1);assert.equal(r.metadata.duplicateClusteredTriangles,1);assert.equal(r.metadata.allInputTrianglesScanned,true);assert.equal(r.metadata.completePasses,2);assert.equal(r.metadata.approximate,true);assert.equal(r.metadata.previewOnly,true);assert.equal(r.metadata.surfaceErrorBound,null);
 assert.equal(r.positions.length,9);assert.equal(r.sourceFacetRepresentative[0],0);assert.match(r.metadata.sourceFacetMapScope,/not exact point correspondence/);
 assert.equal(sha(await fs.readFile(f.input)),sha(f.bytes));assert.equal(sha(await fs.readFile(r.positionsPath)),r.metadata.positionsSha256);
 const metadata=JSON.parse(await fs.readFile(r.metadataPath));assert.deepEqual(metadata.bounds.min,[0,0,0]);assert.deepEqual(metadata.bounds.max,[1,1,0]);
});
test('adaptive clustering derives bounded surfaces from all fine-grid triangles using actual source vertex representatives',async t=>{
 const facets=[],points=new Set();const n=32;
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const a=[x/n,y/n,0],b=[(x+1)/n,y/n,0],c=[x/n,(y+1)/n,0],d=[(x+1)/n,(y+1)/n,0];
  for(const p of [a,b,c,d])points.add(p.join(','));facets.push([...a,...b,...c],[...b,...d,...c]);
 }
 const f=await fixture(t,facets),r=await generateRepairOverview(f.input,{directory:f.directory,maxTriangles:200});
 assert.equal(r.metadata.sourceTriangles,2048);assert.equal(r.metadata.validSourceTriangles,2048);assert.ok(r.metadata.previewTriangles>0&&r.metadata.previewTriangles<=200);assert.ok(r.metadata.attempts.length>1);assert.equal(r.metadata.attempts.at(-1).completed,true);assert.equal(r.metadata.attempts.at(-1).scannedTriangles,2048);
 assert.equal(r.metadata.collapsedByClustering+r.metadata.duplicateClusteredTriangles+r.metadata.previewTriangles,2048);
 for(let i=0;i<r.positions.length;i+=3)assert.ok(points.has(Array.from(r.positions.subarray(i,i+3)).join(',')),'clustering must retain actual input vertices, not invent mean positions');
 for(const index of r.sourceFacetRepresentative)assert.ok(index<2048);
 assert.ok(r.metadata.maxObservedVertexDisplacement>=0);assert.equal(sha(await fs.readFile(f.input)),sha(f.bytes));
});
test('truncated/empty geometry and cancellation fail without replacing the input or publishing a fabricated overview',async t=>{
 const f=await fixture(t,[tri]);await fs.writeFile(f.input,f.bytes.subarray(0,f.bytes.length-1));await assert.rejects(()=>generateRepairOverview(f.input,{directory:f.directory}),/declared triangle count|between one facet/);
 await fs.writeFile(f.input,binary([[0,0,0,0,0,0,0,0,0]]));await assert.rejects(()=>generateRepairOverview(f.input,{directory:f.directory}),/no finite, non-degenerate/);
 await fs.writeFile(f.input,f.bytes);const controller=new AbortController();await assert.rejects(()=>generateRepairOverview(f.input,{directory:f.directory,signal:controller.signal,onProgress(){controller.abort();}}),{name:'AbortError'});
 assert.equal(await fs.stat(path.join(f.directory,'overview-metadata.json')).catch(()=>null),null);assert.equal(sha(await fs.readFile(f.input)),sha(f.bytes));
 await assert.rejects(()=>generateRepairOverview(f.input,{directory:f.directory,maxTriangles:250001}),/triangle limit/);
});
